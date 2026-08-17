from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from flask_bcrypt import Bcrypt
from langchain_ollama import OllamaLLM
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_chroma import Chroma
from langchain_mistralai import ChatMistralAI
from hermes_documents import documents_bp
from collections import Counter
from datetime import datetime
import sqlite3
import json
import os
import shutil
import subprocess
import uuid
from langgraph.func import task
from werkzeug.utils import secure_filename
import csv
import io
from flask import Response
from dotenv import load_dotenv
import os
import sys

# for agentic voice
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)

if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000"])

# JWT Config
app.config["JWT_SECRET_KEY"] = "soc-copilot-secret-key-2024"
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = False
jwt = JWTManager(app)
bcrypt = Bcrypt(app)

# ── SQLite Setup ─────────────────────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), 'users.db')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            username   TEXT UNIQUE NOT NULL,
            email      TEXT NOT NULL,
            password   TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS chat_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            username    TEXT NOT NULL,
            session_id  TEXT NOT NULL,
            role        TEXT NOT NULL,
            message     TEXT NOT NULL,
            model_used  TEXT DEFAULT 'ollama',
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS chat_sessions (
            session_id  TEXT PRIMARY KEY,
            username    TEXT NOT NULL,
            title       TEXT DEFAULT 'New Session',
            model_used  TEXT DEFAULT 'ollama',
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS sentinel_block_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()
    print("SQLite database ready — users.db")

init_db()

app.register_blueprint(documents_bp, url_prefix="/api/documents")
print("Hermes documents API ready")
# ─────────────────────────────────────────────────────────────────────────────

# langchain_ollama.OllamaEmbeddings was not honoring an explicit base_url on
# this machine -- it kept targeting a stray non-standard local port instead
# of 127.0.0.1:11434 regardless of what was passed in. DirectOllamaEmbeddings
# bypasses it and talks to the ollama package directly (confirmed working).
from ai.ollama_embeddings import DirectOllamaEmbeddings

embeddings = DirectOllamaEmbeddings(model="nomic-embed-text", host="http://127.0.0.1:11434")

vectorstore = Chroma(
    persist_directory="../ai/chroma_db",
    embedding_function=embeddings
)

retriever = vectorstore.as_retriever(search_kwargs={"k": 10})


def get_llm(model, api_key=None):
    if model == "ollama_qwen":
        return OllamaLLM(model="qwen2.5:7b"), "local"
    elif model == "ollama_phi3":
        return OllamaLLM(model="phi3:3.8b"), "local"
    elif model == "ollama_phi4mini":
        # Phi-4-mini (3.8B, ~3GB) -- specifically documented as strong at
        # structured output and precise instruction-following despite its
        # small size, unlike a generic small model that trades that away.
        # Roughly half the footprint of qwen2.5:7b -- the lightweight
        # deployment-friendly option, not just a smaller/worse fallback.
        return OllamaLLM(model="phi4-mini"), "local"
    elif model == "ollama_llama32":
        # Llama 3.2 3B (~2.5GB) -- smallest general-purpose option here,
        # solid everyday instruction-following for routine questions where
        # speed/footprint matters more than handling complex reasoning.
        return OllamaLLM(model="llama3.2:3b"), "local"
    elif model == "groq":
        return ChatGroq(
            model="llama-3.3-70b-versatile",
            groq_api_key=api_key or os.getenv("GROQ_API_KEY")
        ), "cloud"
    elif model == "gemini":
        return ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",
            google_api_key=api_key or os.getenv("GEMINI_API_KEY")
        ), "cloud"
    elif model == "mistral":
        return ChatMistralAI(
            model="mistral-small-latest",
            mistral_api_key=os.getenv("MISTRAL_API_KEY")
        ), "cloud"
    else:
        return OllamaLLM(model="sira-model"), "local"


# eve.json is now genuinely large (growing continuously from real honeypot
# traffic) and load_logs() used to re-read and re-parse the entire file on
# every single API call (/stats, /logs, /search, /timeline, /top-ips, ...)
# with no caching at all -- every dashboard refresh got a little slower as
# the file grew. This cache keys off the file's mtime + size (both change
# whenever honeypot_log_sync.py overwrites the file with fresh data) so a
# re-parse only happens when the data has actually changed, not on every
# request between syncs.
MAX_CACHED_EVENTS = 5000
_logs_cache = {"mtime": None, "size": None, "data": None}


def load_logs():
    log_path = os.path.join(os.path.dirname(__file__), '..', 'logs', 'eve.json')
    try:
        stat = os.stat(log_path)
    except FileNotFoundError:
        return []

    if (_logs_cache["data"] is not None
            and _logs_cache["mtime"] == stat.st_mtime
            and _logs_cache["size"] == stat.st_size):
        return _logs_cache["data"]

    logs = []
    try:
        with open(log_path, 'r') as f:
            for line in f:
                try:
                    log = json.loads(line)
                    if log.get('event_type') in ['alert', 'dns', 'http', 'flow', 'tls']:
                        logs.append(log)
                except:
                    pass
    except FileNotFoundError:
        pass

    # eve.json is chronological (oldest first). Keeping the most recent
    # MAX_CACHED_EVENTS instead of all of them bounds both memory and the
    # per-request cost of the Counter()/sort operations every endpoint below
    # runs over this list, while keeping the dashboard focused on current
    # activity rather than the oldest events on record.
    if len(logs) > MAX_CACHED_EVENTS:
        logs = logs[-MAX_CACHED_EVENTS:]

    _logs_cache["mtime"] = stat.st_mtime
    _logs_cache["size"] = stat.st_size
    _logs_cache["data"] = logs
    return logs

# ── ADD HERE ──────────────────────────────────────────────────────────────────
import re

def format_ts(ts):
    if not ts: return "unknown time"
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})', ts)
    if m: return f"{m.group(3)}/{m.group(2)}/{m.group(1)} at {m.group(4)}:{m.group(5)}"
    return ts


# Load once at startup — not inside the route
kokoro_model = Kokoro("kokoro-v0_19.onnx", "voices.bin")

@app.route("/sira-speak", methods=["POST"])
def sira_speak():
    text = request.json.get("text", "")
    if not text:
        return jsonify({"error": "no text"}), 400
    try:
        samples, sample_rate = kokoro_model.create(
            text=text[:500],
            voice="am_adam",   # calm female — change to "am_adam" for male JARVIS voice
            speed=0.88,
            lang="en-us"
        )
        buf = io.BytesIO()
        sf.write(buf, samples, sample_rate, format="WAV")
        buf.seek(0)
        return Response(buf.read(), mimetype="audio/wav")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── SIRA FACE: Kokoro TTS -> Wav2Lip -> synced video ────────────────────────
import subprocess
import uuid

WAV2LIP_DIR = os.path.join(os.path.dirname(__file__), 'Wav2Lip')
WAV2LIP_PYTHON = os.path.join(WAV2LIP_DIR, 'venv', 'Scripts', 'python.exe')
WAV2LIP_CHECKPOINT = os.path.join('checkpoints', 'wav2lip_gan.pth')  # relative -- cwd is WAV2LIP_DIR
WAV2LIP_FACE = os.path.join(WAV2LIP_DIR, 'sira_face.jpg')


@app.route('/sira-face-speak', methods=['POST'])
def sira_face_speak():
    """
    Text -> Kokoro TTS -> Wav2Lip (runs in its own Python 3.10 venv,
    separate from Flask's interpreter) -> synced video, returned directly.
    """
    text = request.json.get("text", "")
    if not text:
        return jsonify({"error": "no text"}), 400

    request_id = uuid.uuid4().hex[:8]
    audio_path = os.path.join(WAV2LIP_DIR, f"temp_audio_{request_id}.wav")
    video_path = os.path.join(WAV2LIP_DIR, f"temp_output_{request_id}.mp4")

    try:
        samples, sample_rate = kokoro_model.create(
            text=text[:500],
            voice="am_adam",
            speed=0.88,
            lang="en-us",
        )
        sf.write(audio_path, samples, sample_rate)

        result = subprocess.run(
            [
                WAV2LIP_PYTHON, "inference.py",
                "--checkpoint_path", WAV2LIP_CHECKPOINT,
                "--face", WAV2LIP_FACE,
                "--audio", audio_path,
                "--outfile", video_path,
                "--pads", "0", "20", "0", "0",  # extra bottom padding -- reduces the mouth-region seam
                "--nosmooth",                    # disable over-smoothing that can cause blur/ghosting
                "--resize_factor", "2",          # downscale processing -- genuine speed win, real quality tradeoff
            ],
            cwd=WAV2LIP_DIR,
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0 or not os.path.exists(video_path):
            return jsonify({
                "error": "Wav2Lip generation failed",
                "details": result.stderr[-800:] if result.stderr else "unknown error",
            }), 500

        with open(video_path, "rb") as f:
            video_bytes = f.read()

        return Response(video_bytes, mimetype="video/mp4")

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Lip-sync generation timed out"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        for p in (audio_path, video_path):
            if os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


# ── AUTH ENDPOINTS ───────────────────────────────────────────────────────────

@app.route('/auth/register', methods=['POST'])
def register():
    data     = request.json
    username = data.get('username', '').strip()
    email    = data.get('email', '').strip()
    password = data.get('password', '').strip()

    if not username or not email or not password:
        return jsonify({"error": "All fields required"}), 400

    hashed_pw = bcrypt.generate_password_hash(password).decode('utf-8')

    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
            (username, email, hashed_pw)
        )
        conn.commit()
        conn.close()
        return jsonify({"message": "Account created successfully"}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "Username already exists"}), 400


@app.route('/auth/login', methods=['POST'])
def login():
    data     = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if not username or not password:
        return jsonify({"error": "All fields required"}), 400

    conn = get_db()
    user = conn.execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()
    conn.close()

    if not user or not bcrypt.check_password_hash(user['password'], password):
        return jsonify({"error": "Invalid username or password"}), 401

    token = create_access_token(identity=username)
    return jsonify({"token": token, "username": username}), 200


@app.route('/auth/me', methods=['GET'])
@jwt_required()
def me():
    username = get_jwt_identity()
    return jsonify({"username": username}), 200


# ── EXISTING ENDPOINTS ───────────────────────────────────────────────────────

@app.route('/ask', methods=['POST'])
def ask():
    data        = request.json
    question    = data.get('question', '')
    model       = data.get('model', 'ollama')
    api_key     = data.get('api_key', None)
    date_filter = data.get('date', None)
    hour_filter = data.get('hour', None)
    history     = data.get('history', [])

    llm, llm_type = get_llm(model, api_key)

    # Identity/meta questions ("who are you", "what can you do") aren't
    # about log data at all -- retrieving logs for them just grabs whatever
    # random entries are nearest in the vector index, and the log-analysis
    # prompt below then forces the model to write a fake incident report
    # about them. Answer these directly instead, with no retrieval.
    if re.search(r'\b(who are you|what are you|what is sira|introduce yourself|what can you do|how do you work|tell me about yourself)\b', question, re.IGNORECASE):
        identity_prompt = f"""You are SIRA — Security Incident Response Assistant.
Speak like JARVIS from Iron Man: calm, precise, address the analyst as "Sir" occasionally.
The analyst asked: "{question}"
Answer conversationally in 2-4 sentences, describing who you are and what you help with
(monitoring Suricata/Zeek network traffic, triaging alerts, investigating threats via Hermes).
Do NOT perform log analysis, cite any IPs, or produce a security report for this message."""
        if llm_type == "local":
            identity_answer = llm.invoke(identity_prompt)
        else:
            identity_answer = llm.invoke(identity_prompt).content
        return jsonify({'answer': identity_answer, 'model_used': model})

    docs = retriever.invoke(question)

    if date_filter:
        docs = [d for d in docs if d.metadata.get('date') == date_filter]
    if hour_filter:
        docs = [d for d in docs if d.metadata.get('hour') == hour_filter]
    if not docs:
        docs = retriever.invoke(question)

# Boost alert docs to top — always prioritise real alerts over flow/dns
    alert_docs = [d for d in docs if d.metadata.get('event_type') == 'alert']
    other_docs  = [d for d in docs if d.metadata.get('event_type') != 'alert']
    docs = alert_docs + other_docs

# If question contains an IP, fetch extra targeted logs for that IP
    ip_match = re.findall(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', question)
    if ip_match:
        extra_docs = []
        for ip in ip_match:
            ip_docs = retriever.invoke(f"src_ip {ip} alert")
            extra_docs += [d for d in ip_docs if
                           d.metadata.get('src_ip') == ip or
                           d.metadata.get('dest_ip') == ip]
        docs = extra_docs + docs

# Deduplicate while preserving order
    seen = set()
    unique_docs = []
    for d in docs:
        if d.page_content not in seen:
           seen.add(d.page_content)
           unique_docs.append(d)
    docs = unique_docs[:15]

    context = "\n\n".join([d.page_content for d in docs])
    context = re.sub(
    r'\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):\d{2}[.\d]*\+\d{4}',
    lambda m: f"at {m.group(1)}:{m.group(2)}",
    context
)

    prompt = f"""You are SIRA — Security Incident Response Assistant.
Speak exactly like JARVIS from Iron Man. Calm, authoritative, precise.
Address the analyst as "Sir" occasionally.
Never ramble. Lead with the most critical information first.
Be definitive — never say "I think" or "maybe".
Short sentences. Maximum impact per word.

STRICT RULES:
- Only use facts from the log data below — never invent details
- Write timestamps as "at HH:MM" not raw ISO format
- Always use exact IPs, timestamps, ports and alert names from the logs
- If information is missing say "Not available in logs"
- Write so a junior analyst with 3 months experience can understand
- VARY your response based on what is being asked — not every question needs 5 sections
- Private/internal IP addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x) and known cloud platform IPs (168.63.129.16, 169.254.169.254) are internal infrastructure traffic, not external attackers — even with a high event count. Never describe traffic from these as unauthorized access, an intrusion, or an attack, and never recommend blocking them.
- If the retrieved log data below doesn't actually relate to the question asked, say so plainly instead of forcing it into a security-report structure

Previous conversation:
{chr(10).join([f"{m['role'].upper()}: {m['content']}" for m in history[-4:] if m.get('content')]) or "None"}

RESPONSE FORMAT RULES — read the question and pick the right format:

IF the question is simple (how many, list, count, what ports):
→ Answer in 2-4 natural sentences. No headers. Just answer directly.
Example: "There are 171 alerts in total. The top attacker is 185.220.101.45 with 23 alerts, followed by 45.33.32.156 with 12 alerts."

IF the question is about a specific alert or IP:
→ Use this structure:

SUMMARY:
2-3 sentences — what happened, who did it, when. Use exact log values.

THREAT DETAILS:
- Alert: [exact signature]
- Attacker IP: [exact src_ip]
- Target IP: [exact dest_ip]
- Time: [exact timestamp]
- Port: [dest_port] / Protocol: [proto]
- Severity: [1=Low / 2=Medium / 3=High]

WHAT THIS MEANS:
2-3 plain English sentences about what this attack is and why it is dangerous.

RISK ASSESSMENT:
- Risk Level: [CRITICAL / HIGH / MEDIUM / LOW]
- Why: [one sentence referencing exact log evidence]
- Confidence: [High / Medium / Low]

RECOMMENDED ACTIONS:
1. [Immediate action — do within 60 minutes — why]
2. [Short term — do today — why]
3. [Long term — do this week — why]

IF the question asks to summarise all events or give an overview:
→ Use this structure:

OVERVIEW:
[Total events, alerts, unique IPs — use exact numbers from logs]

TOP THREATS:
- [Most dangerous alert — IP, signature, time]
- [Second most dangerous]
- [Third most dangerous]

PATTERNS DETECTED:
[What attack patterns are visible — be specific]

PRIORITY ACTIONS:
1. [Most urgent action]
2. [Second priority]
3. [Third priority]

IF the question asks what to do or how to respond:
→ Use this structure:

SITUATION:
[One sentence — current threat state based on logs]

IMMEDIATE ACTIONS:
1. [Do right now — specific reason]
2. [Do right now — specific reason]

TODAY:
1. [Do today — specific reason]

THIS WEEK:
1. [Do this week — specific reason]

Log Data:
{context}

Question: {question}

Answer naturally. Pick the format that fits. Do not force sections that do not apply."""

    try:
        if llm_type == "local":
            answer = llm.invoke(prompt)
        else:
            answer = llm.invoke(prompt).content
    except Exception as e:
        err_msg = str(e)
        if any(k in err_msg.lower() for k in ["api key", "unauthorized", "401", "invalid_api_key", "authentication"]):
            return jsonify({"error": "Invalid API key for this provider. Check the key and try again."}), 401
        return jsonify({"error": f"Could not reach {model}: {err_msg[:200]}"}), 502

    return jsonify({'answer': answer, 'model_used': model})


@app.route('/logs', methods=['GET'])
def get_logs():
    logs = load_logs()
    return jsonify(logs[:50])


@app.route('/models', methods=['GET'])
def get_models():
    # This is the single source of truth for every model's display metadata
    # (name, short "chip" label, whether it's cloud/local). The frontend
    # fetches this on load instead of keeping its own separate hardcoded
    # list -- that duplication is exactly what let ollama_phi4mini and
    # ollama_llama32 exist here but be unreachable in the UI, since the
    # frontend's copy never got updated when these were added.
    return jsonify([
        {"id": "ollama",          "name": "SIRA — qwen2.5:7b (local)",
         "chip": "sira-model (local)", "cloud": False, "requires_key": False},
        {"id": "ollama_phi4mini", "name": "Phi-4-mini 3.8B — lightweight, strong structured output (local)",
         "chip": "phi4-mini (local)", "cloud": False, "requires_key": False},
        {"id": "ollama_llama32",  "name": "Llama 3.2 3B — smallest, everyday questions (local)",
         "chip": "llama3.2 3b (local)", "cloud": False, "requires_key": False},
        {"id": "ollama_phi3",     "name": "Phi3 3.8B — fastest (local)",
         "chip": "phi3 3.8b (local)", "cloud": False, "requires_key": False},
        {"id": "groq",            "name": "Groq — Llama 3.3 70B (cloud)",
         "chip": "groq llama3 (cloud)", "cloud": True, "requires_key": False},
        {"id": "gemini",          "name": "Google Gemini 2.0 Flash (cloud)",
         "chip": "gemini 2.0 (cloud)", "cloud": True, "requires_key": False},
        {"id": "mistral",         "name": "Mistral Small (cloud — free)",
         "chip": "mistral small (cloud)", "cloud": True, "requires_key": False},
    ])


@app.route('/reputation/<ip>', methods=['GET'])
def get_reputation(ip):
    import requests as req
    api_key = os.getenv("ABUSEIPDB_API_KEY")
    try:
        response = req.get(
            "https://api.abuseipdb.com/api/v2/check",
            headers={"Key": api_key, "Accept": "application/json"},
            params={"ipAddress": ip, "maxAgeInDays": 90}
        )
        data = response.json().get("data", {})
        return jsonify({
            "ip":      ip,
            "score":   data.get("abuseConfidenceScore", 0),
            "country": data.get("countryCode", "??"),
            "reports": data.get("totalReports", 0),
            "malicious": data.get("abuseConfidenceScore", 0) > 25
        })
    except:
        return jsonify({"ip": ip, "score": 0, "malicious": False, "error": "lookup failed"})


@app.route('/stats', methods=['GET'])
def stats():
    logs = load_logs()
    total_events = len(logs)
    alert_count  = sum(1 for l in logs if l.get('event_type') == 'alert')
    unique_ips   = len(set(l.get('src_ip') for l in logs if l.get('src_ip')))
    top_source_ips = Counter(
        l.get('src_ip') for l in logs if l.get('src_ip')
    ).most_common(3)
    event_breakdown = dict(Counter(
        l.get('event_type') for l in logs if l.get('event_type')
    ))
    return jsonify({
        "total_events":    total_events,
        "alert_count":     alert_count,
        "unique_ips":      unique_ips,
        "top_source_ips":  top_source_ips,
        "event_breakdown": event_breakdown,
    })


@app.route('/health', methods=['GET'])
def health():
    flask_status = "ok"
    try:
        OllamaLLM(model="sira-model").invoke("ping")
        ollama_status = "ok"
    except Exception as e:
        ollama_status = f"offline — {str(e)[:60]}"
    try:
        vectorstore.get(limit=1)
        chroma_status = "ok"
    except Exception as e:
        chroma_status = f"offline — {str(e)[:60]}"
    overall = "ok" if ollama_status == "ok" and chroma_status == "ok" else "degraded"
    return jsonify({
        "status":   overall,
        "flask":    flask_status,
        "ollama":   ollama_status,
        "chromadb": chroma_status,
    })


# //ADDIING SOME IMPORTANT ENDPOINTS

@app.route('/search', methods=['GET'])
def search():
    query  = request.args.get('q', '').strip()
    event_type = request.args.get('type', None)
    logs  = load_logs()

    if query:
        logs = [l for l in logs if
                query in l.get('src_ip', '') or
                query in l.get('dest_ip', '') or
                query in l.get('alert', {}).get('signature', '')]
    if event_type:
        logs = [l for l in logs if l.get('event_type') == event_type]

    return jsonify(logs[:100])  # return top 100 matches


@app.route('/timeline', methods=['GET'])
def timeline():
    logs = load_logs()
    hourly = Counter()
    for l in logs:
        ts = l.get('timestamp', '')
        if len(ts) >= 13:  # crude check for valid timestamp
            hour = ts[11:13]  # "2024-06-01T14"
            hourly[hour] += 1

    result = [{"hour": h, "count": c} for h, c in sorted(hourly.items())]
    return jsonify(result)

@app.route('/top-ips', methods=['GET'])
def top_ips():
    logs = load_logs()
    limit = int(request.args.get('limit', 10))
    ip_counts = Counter(l.get('src_ip') for l in logs if l.get('src_ip'))
    result = [{"ip": ip, "count": count} for ip, count in ip_counts.most_common(limit)]
    return jsonify(result)


@app.route('/zeek-logs', methods=['GET'])
def zeek_logs():
    zeek_path = os.path.join(os.path.dirname(__file__), '..', 'logs', 'conn.log')
    results = []
    try:
        with open(zeek_path, 'r') as f:
            for line in f:
                if line.startswith('#'):
                    continue
                parts = line.strip().split('\t')
                if len(parts) < 10:
                    continue
                try:
                    from datetime import datetime
                    ts = datetime.fromtimestamp(float(parts[0])).strftime('%Y-%m-%dT%H:%M:%S')
                    results.append({
                        "timestamp": ts,
                        "src_ip": parts[2],
                        "src_port":  parts[3],
                        "dest_ip":   parts[4],
                        "dest_port": parts[5],
                        "protocol":  parts[6],
                        "duration":  parts[8],
                        "state":     parts[11] if len(parts) > 11 else "unknown"
                    })
                except:
                    continue
    except FileNotFoundError:
        return jsonify({"error": "Zeek conn.log not found"}), 404
    return jsonify(results[:100])


@app.route('/correlate/ip', methods=['GET'])
def correlate_ip():
    ip = request.args.get('ip', '').strip()
    if not ip:
        return jsonify({"error": "IP parameter is required"}), 400

    logs = load_logs()
    suricata_events = [l for l in logs if l.get('src_ip') == ip or l.get('dest_ip') == ip]

    zeek_path = os.path.join(os.path.dirname(__file__), '..', 'logs', 'conn.log')
    zeek_events = []
    try:
        with open(zeek_path, 'r') as f:
            for line in f:
                if line.startswith('#'):
                    continue
                parts = line.strip().split('\t')
                if len(parts) < 10:
                    continue
                if ip in parts[2] or ip in parts[4]:
                    try:
                        from datetime import datetime
                        ts = datetime.fromtimestamp(float(parts[0])).strftime('%Y-%m-%dT%H:%M:%S')
                        zeek_events.append({
                            "timestamp": ts,
                            "src_ip":    parts[2],
                            "dest_ip":   parts[4],
                            "protocol":  parts[6],
                            "duration":  parts[8],
                            "state":     parts[11] if len(parts) > 11 else "unknown"
                        })
                    except:
                        continue
    except FileNotFoundError:
        pass

    return jsonify({
        "ip": ip,
        "suricata_events": suricata_events[:50],
        "zeek_events": zeek_events[:50],
        "total_suricata": len(suricata_events),
        "total_zeek": len(zeek_events)
    })


@app.route('/upload', methods=['POST'])
def upload():
    os.environ['OLLAMA_HOST'] = 'http://127.0.0.1:11434'
    if 'file' not in request.files:
        return jsonify({"error" : "No file provided"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error" : "No file selected"}), 400

    filename = secure_filename(file.filename)
    if not (filename.endswith('.json') or filename.endswith('.log')):
            return jsonify({"error": "Only .json or .log files accepted"}), 400

# Always save as eve.json or conn.log regardless of original filename
    save_as = 'eve.json' if filename.endswith('.json') else 'conn.log'
    save_path = os.path.join(os.path.dirname(__file__), '..', 'logs', save_as)

    backup_path = save_path + '.bak'
    if os.path.exists(save_path):
        shutil.copy(save_path, backup_path)

    file.save(save_path)

    try:
        # rag_script = os.path.join(os.path.dirname(__file__), '..', 'ai', 'rag_setup.py')
        # subprocess.run(['python', rag_script], timeout=120, check=True)
        rag_script = os.path.join(os.path.dirname(__file__), '..', 'ai', 'rag_setup.py')
        ai_dir = os.path.join(os.path.dirname(__file__), '..', 'ai')
        subprocess.run([sys.executable, rag_script], timeout=120, check=True, cwd=ai_dir)
        new_logs = load_logs()
        return jsonify({
            "message": f"{save_as} uploaded and ChromaDB rebuilt successfully",
            "events_loaded": len(new_logs)
        })
    except subprocess.TimeoutExpired:
        return jsonify({"error": "ChromaDB rebuild timed out"}), 500
    except subprocess.CalledProcessError as e:
        return jsonify({"error": f"ChromaDB rebuild failed: {str(e)}"}), 500


@app.route('/export', methods=['GET'])
def export():
    logs = load_logs()
    event_type = request.args.get('type', None)

    if event_type:
        logs = [l for l in logs if l.get('event_type') == event_type]

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow(['timestamp', 'event_type', 'src_ip', 'src_port', 'dest_ip', 'dest_port', 'proto', 'alert_signature', 'alert_category', 'severity'])

    for l in logs:
        alert = l.get('alert', {})
        writer.writerow([
            l.get('timestamp', ''),
            l.get('event_type', ''),
            l.get('src_ip', ''),
            l.get('src_port', ''),
            l.get('dest_ip', ''),
            l.get('dest_port', ''),
            l.get('proto', ''),
            alert.get('signature', ''),
            alert.get('category', ''),
            alert.get('severity', '')
        ])

    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={"Content-Disposition": "attachment; filename=soc-copilot-export.csv"}
    )


@app.route('/ask-all', methods=['POST'])
def ask_all():
    data = request.json
    question = data.get('question', '')

    docs = retriever.invoke(question)
    alert_docs = [d for d in docs if d.metadata.get('event_type') == 'alert']
    other_docs  = [d for d in docs if d.metadata.get('event_type') != 'alert']
    docs = (alert_docs + other_docs)[:10]
    context = "\n\n".join([d.page_content for d in docs])

    prompt = f"""You are SIRA, Security Incident Response Assistant.
Analyse the log data below and answer the question clearly and concisely.
Log Data:
{context}
Question: {question}
Answer:"""

    results = {}
    models_to_try = [
        ("groq",   ChatGroq(model="llama-3.3-70b-versatile", groq_api_key=os.getenv("GROQ_API_KEY"), temperature=0)),
        ("gemini", ChatGoogleGenerativeAI(model="gemini-2.0-flash", google_api_key=os.getenv("GEMINI_API_KEY"), temperature=0)),
        ("mistral",ChatMistralAI(model="mistral-small-latest", mistral_api_key=os.getenv("MISTRAL_API_KEY"))),
    ]

    for name, llm in models_to_try:
        try:
            results[name] = llm.invoke(prompt).content
        except Exception as e:
            results[name] = f"Error: {str(e)[:100]}"

    return jsonify(results)


# ── HISTORY ENDPOINTS ────────────────────────────────────────────────────────

@app.route('/history/sessions', methods=['GET'])
@jwt_required()
def get_sessions():
    username = get_jwt_identity()
    conn     = get_db()
    sessions = conn.execute(
        """SELECT s.session_id, s.title, s.model_used, s.created_at, s.updated_at,
                  COUNT(c.id) as message_count
           FROM chat_sessions s
           LEFT JOIN chat_history c ON s.session_id = c.session_id
           WHERE s.username = ?
           GROUP BY s.session_id
           ORDER BY s.updated_at DESC""",
        (username,)
    ).fetchall()
    conn.close()
    return jsonify([dict(s) for s in sessions])


@app.route('/history/sessions/<session_id>', methods=['GET'])
@jwt_required()
def get_session_messages(session_id):
    username = get_jwt_identity()
    conn     = get_db()
    messages = conn.execute(
        """SELECT role, message, model_used, created_at
           FROM chat_history
           WHERE session_id = ? AND username = ?
           ORDER BY created_at ASC""",
        (session_id, username)
    ).fetchall()
    conn.close()
    return jsonify([dict(m) for m in messages])


@app.route('/history/sessions/<session_id>', methods=['DELETE'])
@jwt_required()
def delete_session(session_id):
    username = get_jwt_identity()
    conn     = get_db()
    conn.execute("DELETE FROM chat_history WHERE session_id = ? AND username = ?", (session_id, username))
    conn.execute("DELETE FROM chat_sessions WHERE session_id = ? AND username = ?", (session_id, username))
    conn.commit()
    conn.close()
    return jsonify({"message": "Session deleted"})


@app.route('/history/save', methods=['POST'])
@jwt_required()
def save_message():
    username   = get_jwt_identity()
    data       = request.json
    session_id = data.get('session_id')
    role       = data.get('role')
    message    = data.get('message')
    model_used = data.get('model_used', 'ollama')
    title      = data.get('title', 'Security Analysis')

    if not session_id or not role or not message:
        return jsonify({"error": "session_id, role, message required"}), 400

    conn = get_db()
    conn.execute(
        """INSERT INTO chat_sessions (session_id, username, title, model_used, updated_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(session_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP""",
        (session_id, username, title, model_used)
    )
    conn.execute(
        """INSERT INTO chat_history (username, session_id, role, message, model_used)
           VALUES (?, ?, ?, ?, ?)""",
        (username, session_id, role, message, model_used)
    )
    conn.commit()
    conn.close()
    return jsonify({"message": "Saved"}), 201


@app.route('/history/clear-all', methods=['DELETE'])
@jwt_required()
def clear_all_history():
    username = get_jwt_identity()
    conn     = get_db()
    conn.execute("DELETE FROM chat_history WHERE username = ?", (username,))
    conn.execute("DELETE FROM chat_sessions WHERE username = ?", (username,))
    conn.commit()
    conn.close()
    return jsonify({"message": "All history cleared"})


@app.route('/log-info', methods=['GET'])
def log_info():
    logs = load_logs()
    log_path = os.path.join(os.path.dirname(__file__), '..', 'logs', 'eve.json')
    file_size = os.path.getsize(log_path) if os.path.exists(log_path) else 0
    return jsonify({
        "filename": "eve.json",
        "total_events": len(logs),
        "file_size_kb": round(file_size / 1024, 1)
    })


# ── RUSTINEL: local endpoint detection (Sigma/YARA/IOC), separate source ────
# from both the honeypot's network logs and Sentinel's raw connection
# reports. Reads ECS NDJSON alert files Rustinel writes locally -- same
# machine as this backend, so no sync/network transfer needed, just a
# direct file read (see ai/rustinel_reader.py).
from ai.rustinel_reader import load_rustinel_alerts


@app.route('/rustinel-alerts', methods=['GET'])
def rustinel_alerts():
    limit = min(int(request.args.get('limit', 50)), 500)
    alerts = load_rustinel_alerts()
    return jsonify(alerts[:limit])


@app.route('/attacker-profile/<ip>', methods=['GET'])
def attacker_profile(ip):
    import requests as req

    # 1. Get all suricata events for this IP
    logs = load_logs()
    events = [l for l in logs if l.get('src_ip') == ip or l.get('dest_ip') == ip]
    alerts = [e for e in events if e.get('event_type') == 'alert']

    # 2. AbuseIPDB
    abuse_data = {}
    try:
        r = req.get("https://api.abuseipdb.com/api/v2/check",
            headers={"Key": os.getenv("ABUSEIPDB_API_KEY"), "Accept": "application/json"},
            params={"ipAddress": ip, "maxAgeInDays": 90})
        abuse_data = r.json().get("data", {})
    except: pass

    # 3. Geolocation
    geo = {}
    try:
        r = req.get(f"http://ip-api.com/json/{ip}", timeout=5)
        geo = r.json()
    except: pass

    # 4. Attack signatures used
    signatures = list(set(e.get('alert', {}).get('signature', '') for e in alerts if e.get('alert')))

    # 5. Ports targeted
    ports = list(set(str(e.get('dest_port', '')) for e in events if e.get('dest_port')))

    # 6. Ask SIRA to profile the attacker
    docs = retriever.invoke(f"attacks from {ip}")
    context = "\n\n".join([d.page_content for d in docs[:8]])
    prompt = f"""You are SIRA — speak like JARVIS from Iron Man. Calm, authoritative, precise. Address the analyst as Sir occasionally. Based on the log data, create a threat actor profile for IP {ip}.
Log context:
{context}

Attack signatures seen: {', '.join(signatures[:5]) or 'None'}
Ports targeted: {', '.join(ports[:10]) or 'Unknown'}
AbuseIPDB score: {abuse_data.get('abuseConfidenceScore', 'Unknown')}
Country: {geo.get('country', 'Unknown')}

Respond EXACTLY in this format:

THREAT ACTOR TYPE:
One of: Script Kiddie / Opportunistic Scanner / Targeted Attacker / APT / Botnet Node

LIKELY INTENT:
One sentence — what is this attacker trying to achieve?

TACTICS:
- Tactic 1
- Tactic 2
- Tactic 3

DANGER LEVEL:
CRITICAL or HIGH or MEDIUM or LOW — one sentence why.

RECOMMENDED BLOCK:
YES or NO — one sentence justification."""

    try:
        llm = OllamaLLM(model="sira-model")
        sira_assessment = llm.invoke(prompt)
    except:
        sira_assessment = "SIRA offline — manual review required"

    return jsonify({
        "ip": ip,
        "geo": {
            "country": geo.get("country", "Unknown"),
            "city": geo.get("city", "Unknown"),
            "isp": geo.get("isp", "Unknown"),
            "flag": geo.get("countryCode", "")
        },
        "abuse": {
            "score": abuse_data.get("abuseConfidenceScore", 0),
            "reports": abuse_data.get("totalReports", 0),
            "malicious": abuse_data.get("abuseConfidenceScore", 0) > 25
        },
        "stats": {
            "total_events": len(events),
            "total_alerts": len(alerts),
            "signatures": signatures[:5],
            "ports_targeted": ports[:10]
        },
        "sira_assessment": sira_assessment
    })


@app.route('/what-if', methods=['POST'])
def what_if():
    data = request.json
    alert_signature = data.get('signature', '')
    src_ip = data.get('src_ip', '')
    dest_ip = data.get('dest_ip', '')

    docs = retriever.invoke(f"{alert_signature} {src_ip}")
    context = "\n\n".join([d.page_content for d in docs[:8]])

    prompt = f"""You are SIRA. Respond like JARVIS — calm, authoritative, precise. Address the analyst as Sir occasionally."

Alert: {alert_signature}
Attacker IP: {src_ip}
Target IP: {dest_ip}

Log context:
{context}

Respond EXACTLY in this format:

IMMEDIATE IMPACT:
What would have happened in the first 60 seconds if this was not blocked.

ATTACK CHAIN:
Step 1: What the attacker does first
Step 2: What they do next
Step 3: The likely final goal

POTENTIAL DAMAGE:
- Data at risk: what data could be stolen
- Systems at risk: what systems could be compromised
- Business impact: what is the real world consequence

LIKELIHOOD:
CERTAIN or PROBABLE or POSSIBLE — one sentence on how likely this attack would have succeeded.

LESSON:
One plain English sentence on what this tells us about our defences."""

    try:
        llm = OllamaLLM(model="sira-model")
        answer = llm.invoke(prompt)
    except Exception as e:
        answer = f"Error: {str(e)}"

    return jsonify({"answer": answer, "signature": alert_signature, "src_ip": src_ip})

# ─────────────────────────────────────────────────────────────────────────────

@app.route('/hermes-agent', methods=['POST'])
def hermes_agent():
    data = request.json
    task  = data.get('task', '').strip()
    # Optional model override from the frontend's performance-tier picker --
    # defaults to nous-hermes2 (today's behaviour) if not provided.
    model = data.get('model', 'nous-hermes2')
    if not task:
        return jsonify({"error": "No task provided"}), 400

    try:
        from ai.hermes_agent import run_hermes_agent
        result = run_hermes_agent(task, model=model)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/cve-lookup', methods=['GET'])
def cve_lookup():
    import requests as req
    signature = request.args.get('signature', '').strip()
    if not signature:
        return jsonify({"error": "No signature provided"}), 400

    keywords = signature
    for prefix in ['ET ', 'GPL ', 'SURICATA ', 'EMERGING-THREATS ', 'POLICY ', 'MALWARE ', 'SCAN ', 'WEB_SERVER ', 'EXPLOIT ']:
        keywords = keywords.replace(prefix, '')

    search_term = ' '.join(keywords.split()[:3])

    results = []
    try:
        response = req.get(
            "https://services.nvd.nist.gov/rest/json/cves/2.0",
            params={"keywordSearch": search_term, "resultsPerPage": 5, "startIndex": 0},
            headers={"User-Agent": "SOC-Copilot/1.0"},
            timeout=10
        )
        data = response.json()
        vulnerabilities = data.get("vulnerabilities", [])

        for vuln in vulnerabilities:
            cve = vuln.get("cve", {})
            cve_id = cve.get("id", "Unknown")
            descriptions = cve.get("descriptions", [])
            description = next((d["value"] for d in descriptions if d["lang"] == "en"), "No description")

            metrics = cve.get("metrics", {})
            cvss_score = None
            cvss_severity = "UNKNOWN"

            for version in ["cvssMetricV31", "cvssMetricV30", "cvssMetricV2"]:
                metric = metrics.get(version, [])
                if metric:
                    cvss_data = metric[0].get("cvssData", {})
                    cvss_score = cvss_data.get("baseScore")
                    cvss_severity = cvss_data.get("baseSeverity", "UNKNOWN")
                    break

            results.append({
                "cve_id": cve_id,
                "description": description[:200] + "..." if len(description) > 200 else description,
                "cvss_score": cvss_score,
                "cvss_severity": cvss_severity,
                "published": cve.get("published", "")[:10],
                "url": f"https://nvd.nist.gov/vuln/detail/{cve_id}"
            })

    except Exception as e:
        return jsonify({"error": f"CVE lookup failed: {str(e)}", "results": []}), 500

    return jsonify({
        "signature": signature,
        "search_term": search_term,
        "results": results,
        "total": len(results),
        "source": "NVD — National Vulnerability Database"
    })


# ── SENTINEL: SQLite-backed machine state (survives restarts/debug reloads) ──

def init_sentinel_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS sentinel_machines (
            machine_id    TEXT PRIMARY KEY,
            last_seen     TEXT,
            platform      TEXT,
            local_ip      TEXT,
            connections   TEXT,
            processes     TEXT,
            suspicious    TEXT,
            alert         INTEGER DEFAULT 0
        )
    ''')
    conn.commit()
    conn.close()

init_sentinel_db()

# Ports commonly associated with backdoors, RATs, and C2 channels.
# Heuristic only — a starting point, not a substitute for real threat intel.
SUSPICIOUS_PORTS = {
    4444, 1337, 31337, 6667, 6666, 12345, 54321, 9001, 4443, 8888
}

def detect_suspicious(connections):
    """
    The agent only reports raw connections — it makes no judgment calls.
    That judgment happens here, server-side, where reputation/context lives.
    """
    flagged = []
    for c in connections:
        remote = c.get("remote", "")
        try:
            port = int(remote.rsplit(":", 1)[-1])
        except (ValueError, IndexError):
            continue
        if port in SUSPICIOUS_PORTS:
            flagged.append(c)
    return flagged


@app.route("/ingest/<machine_id>", methods=["POST"])
def ingest(machine_id):
    auth_header = request.headers.get("Authorization", "")
    expected_key = os.getenv("SENTINEL_SECRET", "sira-sentinel-2026")
    if not auth_header.startswith("Bearer ") or auth_header[len("Bearer "):].strip() != expected_key:
        return jsonify({"error": "unauthorized"}), 401

    data = request.json or {}
    connections = data.get("connections", [])
    suspicious = detect_suspicious(connections)

    conn = get_db()
    conn.execute('''
        INSERT INTO sentinel_machines
            (machine_id, last_seen, platform, local_ip, connections, processes, suspicious, alert)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(machine_id) DO UPDATE SET
            last_seen=excluded.last_seen,
            platform=excluded.platform,
            local_ip=excluded.local_ip,
            connections=excluded.connections,
            processes=excluded.processes,
            suspicious=excluded.suspicious,
            alert=excluded.alert
    ''', (
        machine_id,
        data.get("timestamp"),
        data.get("platform"),
        data.get("local_ip"),
        json.dumps(connections),
        json.dumps(data.get("processes", [])),
        json.dumps(suspicious),
        1 if suspicious else 0,
    ))
    conn.commit()

    commands = []
    rows = conn.execute("SELECT ip FROM sentinel_block_queue").fetchall()
    for row in rows:
        commands.append({"action": "block_ip", "ip": row["ip"]})
    conn.execute("DELETE FROM sentinel_block_queue")
    conn.commit()
    conn.close()

    if suspicious:
        print(f"[SENTINEL] Suspicious activity on {machine_id}: {suspicious}")

    return jsonify({"status": "received", "machine": machine_id, "commands": commands})


@app.route("/machines", methods=["GET"])
def get_machines():
    conn = get_db()
    rows = conn.execute("SELECT * FROM sentinel_machines").fetchall()
    conn.close()
    result = []
    for r in rows:
        suspicious = json.loads(r["suspicious"] or "[]")
        processes = json.loads(r["processes"] or "[]")
        connections = json.loads(r["connections"] or "[]")
        result.append({
            "id":               r["machine_id"],
            "last_seen":        r["last_seen"],
            "platform":         r["platform"],
            "local_ip":         r["local_ip"],
            "alert":            bool(r["alert"]),
            "suspicious_count": len(suspicious),
            "suspicious":       suspicious[:5],
            "processes":        processes[:5],
            "connections":      connections[:5],
        })
    return jsonify(result)


@app.route("/machine/<machine_id>", methods=["GET"])
def get_machine(machine_id):
    conn = get_db()
    r = conn.execute("SELECT * FROM sentinel_machines WHERE machine_id = ?", (machine_id,)).fetchone()
    conn.close()
    if not r:
        return jsonify({})
    return jsonify({
        "id":          r["machine_id"],
        "last_seen":   r["last_seen"],
        "platform":    r["platform"],
        "local_ip":    r["local_ip"],
        "alert":       bool(r["alert"]),
        "suspicious":  json.loads(r["suspicious"] or "[]"),
        "processes":   json.loads(r["processes"] or "[]"),
        "connections": json.loads(r["connections"] or "[]"),
    })


@app.route("/block-ip", methods=["POST"])
def block_ip_route():
    ip = request.json.get("ip")
    if not ip:
        return jsonify({"error": "no ip"}), 400
    conn = get_db()
    conn.execute("INSERT INTO sentinel_block_queue (ip) VALUES (?)", (ip,))
    conn.commit()
    conn.close()
    return jsonify({"status": "queued", "ip": ip})


@app.route('/sentinel-config', methods=['GET', 'POST'])
def sentinel_config():
    config_path = os.path.join(os.path.dirname(__file__), '..', 'agent', 'sentinel_config.json')
    if request.method == 'GET':
        try:
            with open(config_path) as f:
                return jsonify(json.load(f))
        except FileNotFoundError:
            return jsonify({"server": "", "agent_key": "", "machine_id": ""})

    data = request.json
    new_ip = data.get('ip', '').strip()
    if not new_ip:
        return jsonify({"error": "IP required"}), 400

    existing = {}
    if os.path.exists(config_path):
        with open(config_path) as f:
            existing = json.load(f)
    existing['server'] = f"http://{new_ip}:5000"

    with open(config_path, 'w') as f:
        json.dump(existing, f, indent=2)

    return jsonify({"message": "Sentinel server IP updated", "server": existing['server']})


# ── SOC 2 COMPLIANCE DASHBOARD ────────────────────────────────────────────────
# Controls are evaluated live against real telemetry (Suricata/Zeek events in
# eve.json, Sentinel endpoint check-ins, and the LLM/vector-store health check)
# rather than stored as opinions — there is no separate "compliance" data
# source, so each control's pass/warn/fail is a heuristic read of the same
# signals the rest of the app already collects.

TSC_CATEGORIES = {
    "security":              "Security",
    "availability":          "Availability",
    "confidentiality":       "Confidentiality",
    "processing_integrity":  "Processing Integrity",
    "privacy":               "Privacy",
}

def _log_date_hour(ts):
    """Extract (YYYY-MM-DD, hour:int) from a Suricata ISO timestamp, or (None, None)."""
    m = re.match(r'(\d{4}-\d{2}-\d{2})T(\d{2}):', ts or '')
    if not m:
        return None, None
    return m.group(1), int(m.group(2))


def _compliance_context():
    logs = load_logs()
    total_events = len(logs)
    alert_events = [l for l in logs if l.get('event_type') == 'alert']
    alert_count = len(alert_events)
    tls_count = sum(1 for l in logs if l.get('event_type') == 'tls')
    dns_count = sum(1 for l in logs if l.get('event_type') == 'dns')
    unique_ips = len(set(l.get('src_ip') for l in logs if l.get('src_ip')))
    critical_alerts = sum(1 for l in alert_events if l.get('alert', {}).get('severity') == 1)

    try:
        OllamaLLM(model="sira-model").invoke("ping")
        ollama_ok = True
    except Exception:
        ollama_ok = False
    try:
        vectorstore.get(limit=1)
        chroma_ok = True
    except Exception:
        chroma_ok = False

    conn = get_db()
    machines = conn.execute("SELECT * FROM sentinel_machines").fetchall()
    user_count = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
    conn.close()

    now = datetime.utcnow()
    stale_machines = 0
    flagged_machines = 0
    for m in machines:
        if m["alert"]:
            flagged_machines += 1
        try:
            last_seen = datetime.fromisoformat((m["last_seen"] or "").replace("Z", ""))
            if (now - last_seen).total_seconds() > 900:
                stale_machines += 1
        except ValueError:
            stale_machines += 1

    return {
        "total_events": total_events,
        "alert_count": alert_count,
        "alert_ratio": (alert_count / total_events) if total_events else 0,
        "tls_count": tls_count,
        "dns_count": dns_count,
        "dns_ratio": (dns_count / total_events) if total_events else 0,
        "unique_ips": unique_ips,
        "critical_alerts": critical_alerts,
        "ollama_ok": ollama_ok,
        "chroma_ok": chroma_ok,
        "machine_count": len(machines),
        "stale_machines": stale_machines,
        "flagged_machines": flagged_machines,
        "user_count": user_count,
    }


def _evaluate_controls(ctx):
    def status(cond_pass, cond_warn=False):
        return "pass" if cond_pass else ("warn" if cond_warn else "fail")

    return [
        {"id": "SEC-01", "category": "security", "name": "Intrusion Detection Coverage",
         "description": "Suricata/Zeek sensors are actively producing telemetry.",
         "status": status(ctx["total_events"] > 0)},
        {"id": "SEC-02", "category": "security", "name": "Alert Triage Rate",
         "description": "Alert volume stays within an acceptable share of total traffic.",
         "status": status(ctx["alert_ratio"] < 0.25, ctx["alert_ratio"] < 0.5)},
        {"id": "SEC-03", "category": "security", "name": "Malicious IP Response",
         "description": "No Sentinel endpoint currently reports unresolved suspicious activity.",
         "status": status(ctx["flagged_machines"] == 0, ctx["flagged_machines"] <= 1)},
        {"id": "SEC-04", "category": "security", "name": "Threat Actor Volume",
         "description": "Distinct attacking source IPs remain below the risk threshold.",
         "status": status(ctx["unique_ips"] < 20, ctx["unique_ips"] < 50)},
        {"id": "AVAIL-01", "category": "availability", "name": "AI Assistant Availability",
         "description": "SIRA's local LLM and vector store are reachable.",
         "status": status(ctx["ollama_ok"] and ctx["chroma_ok"], ctx["ollama_ok"] or ctx["chroma_ok"])},
        {"id": "AVAIL-02", "category": "availability", "name": "Endpoint Heartbeat Coverage",
         "description": "Registered Sentinel endpoints have checked in within the last 15 minutes.",
         "status": status(ctx["machine_count"] > 0 and ctx["stale_machines"] == 0,
                           ctx["machine_count"] > 0 and ctx["stale_machines"] < ctx["machine_count"])},
        {"id": "CONF-01", "category": "confidentiality", "name": "Encrypted Session Observability",
         "description": "TLS traffic is being observed and logged, confirming encryption-in-transit visibility.",
         "status": status(ctx["tls_count"] > 0, ctx["total_events"] == 0)},
        {"id": "CONF-02", "category": "confidentiality", "name": "DNS Exfiltration Watch",
         "description": "DNS event volume stays within expected bounds (no tunnelling spike).",
         "status": status(ctx["dns_ratio"] < 0.4, ctx["dns_ratio"] < 0.7)},
        {"id": "PI-01", "category": "processing_integrity", "name": "Endpoint Process Integrity",
         "description": "No Sentinel endpoint currently reports a suspicious process or connection.",
         "status": status(ctx["flagged_machines"] == 0, ctx["flagged_machines"] <= 1)},
        {"id": "PI-02", "category": "processing_integrity", "name": "Telemetry Pipeline Integrity",
         "description": "The log ingestion pipeline (eve.json) is producing parsed events.",
         "status": status(ctx["total_events"] > 0)},
        {"id": "PRIV-01", "category": "privacy", "name": "Access Audit Trail",
         "description": "User authentication activity is captured for accountability.",
         "status": status(ctx["user_count"] > 0)},
        {"id": "PRIV-02", "category": "privacy", "name": "Critical Alert Exposure",
         "description": "No unresolved critical-severity alerts are outstanding.",
         "status": status(ctx["critical_alerts"] == 0, ctx["critical_alerts"] <= 2)},
    ]


@app.route('/compliance/overview', methods=['GET'])
def compliance_overview():
    ctx = _compliance_context()
    controls = _evaluate_controls(ctx)
    weight = {"pass": 1, "warn": 0.5, "fail": 0}

    criteria = []
    for key, label in TSC_CATEGORIES.items():
        cat_controls = [c for c in controls if c["category"] == key]
        total = len(cat_controls) or 1
        score = round(sum(weight[c["status"]] for c in cat_controls) / total * 100)
        criteria.append({
            "key": key,
            "label": label,
            "score": score,
            "controls_passing": sum(1 for c in cat_controls if c["status"] == "pass"),
            "controls_total": len(cat_controls),
        })

    overall_score = round(sum(c["score"] for c in criteria) / len(criteria)) if criteria else 0
    return jsonify({
        "overall_score": overall_score,
        "criteria": criteria,
        "controls_passing": sum(1 for c in controls if c["status"] == "pass"),
        "controls_total": len(controls),
        "findings_open": ctx["alert_count"],
        "generated_at": datetime.utcnow().isoformat() + "Z",
    })


@app.route('/compliance/controls', methods=['GET'])
def compliance_controls():
    ctx = _compliance_context()
    return jsonify(_evaluate_controls(ctx))


@app.route('/compliance/findings', methods=['GET'])
def compliance_findings():
    limit = min(int(request.args.get('limit', 10)), 200)
    logs = load_logs()
    alerts = [l for l in logs if l.get('event_type') == 'alert']
    alerts.sort(key=lambda l: l.get('timestamp', ''), reverse=True)

    severity_map = {1: "critical", 2: "elevated", 3: "informational"}
    findings = []
    for i, l in enumerate(alerts[:limit]):
        a = l.get('alert', {})
        severity = a.get('severity', 3)
        findings.append({
            "id": f"FND-{i+1:04d}",
            "title": a.get('signature', 'Unknown signature'),
            "category": a.get('category', 'Uncategorized'),
            "severity": severity_map.get(severity, "informational"),
            "src_ip": l.get('src_ip'),
            "dest_ip": l.get('dest_ip'),
            "detected_at": l.get('timestamp'),
        })
    return jsonify(findings)


@app.route('/compliance/heatmap', methods=['GET'])
def compliance_heatmap():
    logs = load_logs()
    grid = Counter()
    for l in logs:
        if l.get('event_type') != 'alert':
            continue
        date_str, hour = _log_date_hour(l.get('timestamp'))
        if date_str is None:
            continue
        try:
            weekday = datetime.strptime(date_str, "%Y-%m-%d").weekday()
        except ValueError:
            continue
        grid[(weekday, hour)] += 1

    cells = [{"weekday": wd, "hour": hr, "count": c} for (wd, hr), c in grid.items()]
    return jsonify({"cells": cells, "max": max(grid.values()) if grid else 0})


@app.route('/compliance/trend', methods=['GET'])
def compliance_trend():
    logs = load_logs()
    by_day = {}
    for l in logs:
        date_str, _ = _log_date_hour(l.get('timestamp'))
        if date_str is None:
            continue
        bucket = by_day.setdefault(date_str, {"total": 0, "alerts": 0})
        bucket["total"] += 1
        if l.get('event_type') == 'alert':
            bucket["alerts"] += 1

    series = []
    for date_str in sorted(by_day.keys()):
        b = by_day[date_str]
        score = round(100 * (1 - (b["alerts"] / b["total"] if b["total"] else 0)))
        series.append({"date": date_str, "score": max(0, min(100, score)),
                        "alerts": b["alerts"], "total_events": b["total"]})
    return jsonify(series)


if __name__ == '__main__':
    # Pull Suricata/Zeek logs from the public honeypot VM automatically,
    # instead of manually uploading eve.json/conn.log. WERKZEUG_RUN_MAIN is
    # only set in the child process the debug reloader actually forks to
    # serve requests -- checking it here (rather than starting unconditionally)
    # stops the sync thread from being started twice (once in the reloader's
    # parent watcher process, once in the child) when debug=True.
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        from ai.honeypot_log_sync import start_background_sync
        start_background_sync()

    # NOTE: debug=True's reloader watches every file under the project tree
    # recursively -- this originally caused two separate problems:
    #
    # 1) /sira-face-speak runs inference (touches files inside
    #    face_detection/detection/sfd/), which the reloader saw as "code
    #    changed" and killed + restarted the whole Flask process mid-request
    #    -> browser saw a CORS failure (connection reset, no headers ever
    #    sent), not a real error.
    #
    # 2) honeypot_log_sync.py writes ../logs/eve.json and ../logs/conn.log
    #    every ~15s whenever the honeypot has new data, and rag_setup.py
    #    rewrites ../ai/chroma_db/ on every rebuild. The reloader was
    #    watching both of those too, so a routine sync write was *also*
    #    seen as "code changed" and restarted Flask -- which re-ran
    #    start_background_sync() in the new child process, which then wrote
    #    to eve.json again on its next poll, restarting Flask again, and so
    #    on. This is what looked like "the embeddings/rebuild ran multiple
    #    times back-to-back": it was actually Flask itself restarting in a
    #    loop, not the rebuild script being invoked repeatedly.
    #
    # exclude_patterns keeps the reloader watching your actual app code
    # while ignoring Wav2Lip's working files and the two data directories
    # that are never supposed to contain source code in the first place.
    app.run(
        host='0.0.0.0',
        debug=True,
        port=5000,
        exclude_patterns=[
            "*/Wav2Lip/*",
            "*\\Wav2Lip\\*",
            "*/logs/*",
            "*\\logs\\*",
            "*/chroma_db/*",
            "*\\chroma_db\\*",
        ],
    )