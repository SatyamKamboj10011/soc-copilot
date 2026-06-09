from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from flask_bcrypt import Bcrypt
from langchain_ollama import OllamaLLM
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_ollama import OllamaEmbeddings
from langchain_chroma import Chroma
from langchain_mistralai import ChatMistralAI
from collections import Counter
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
    conn.commit()
    conn.close()
    print("SQLite database ready — users.db")

init_db()
# ─────────────────────────────────────────────────────────────────────────────

embeddings = OllamaEmbeddings(model="nomic-embed-text")

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


def load_logs():
    
    logs = []
    log_path = os.path.join(os.path.dirname(__file__), '..', 'logs', 'eve.json')
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

    if llm_type == "local":
        answer = llm.invoke(prompt)
    else:
        answer = llm.invoke(prompt).content

    return jsonify({'answer': answer, 'model_used': model})


@app.route('/logs', methods=['GET'])
def get_logs():
    logs = load_logs()
    return jsonify(logs[:50])


@app.route('/models', methods=['GET'])
def get_models():
    return jsonify([
        {"id": "ollama",      "name": "SIRA — qwen2.5:7b (local)",          "requires_key": False},
        {"id": "ollama_phi3", "name": "Phi3 3.8B — fastest (local)",         "requires_key": False},
        {"id": "groq",        "name": "Groq — Llama 3.3 70B (cloud)",        "requires_key": False},
        {"id": "gemini",      "name": "Google Gemini 2.0 Flash (cloud)",      "requires_key": False},
        {"id": "mistral",     "name": "Mistral Small (cloud — free)",         "requires_key": False},
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
        rag_script = os.path.join(os.path.dirname(__file__), '..', 'ai', 'rag_setup.py')
        subprocess.run(['python', rag_script], timeout=120, check=True)
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
    task = data.get('task', '').strip()
    if not task:
        return jsonify({"error": "No task provided"}), 400

    try:
        from ai.hermes_agent import run_hermes_agent
        result = run_hermes_agent(task)
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


# Store connected machines in memory
connected_machines = {}
ips_to_block = []

@app.route("/ingest/<machine_id>", methods=["POST"])
def ingest(machine_id):
    data = request.json
    secret = data.get("secret")
    if secret != os.getenv("SENTINEL_SECRET", "sira-sentinel-2026"):
        return jsonify({"error": "unauthorized"}), 401
    connected_machines[machine_id] = {
        "last_seen":   data.get("timestamp"),
        "platform":    data.get("platform"),
        "local_ip":    data.get("local_ip"),
        "connections": data.get("connections", []),
        "processes":   data.get("processes", []),
        "suspicious":  data.get("suspicious", []),
        "alert":       data.get("alert", False)
    }

    commands = []

    # Send back any IPs to block
    for ip in ips_to_block:
        commands.append({"action": "block_ip", "ip": ip})
    ips_to_block.clear()

    # Auto-trigger Hermes if suspicious activity detected
    if data.get("alert") and data.get("suspicious"):
        suspicious = data["suspicious"]
        print(f"[SENTINEL] Suspicious activity on {machine_id}: {suspicious}")

    return jsonify({"status": "received", "machine": machine_id, "commands": commands})

@app.route("/machines", methods=["GET"])
def get_machines():
    return jsonify([
        {
            "id":       mid,
            "last_seen": info["last_seen"],
            "platform": info["platform"],
            "local_ip": info["local_ip"],
            "alert":    info["alert"],
            "suspicious_count": len(info["suspicious"])
        }
        for mid, info in connected_machines.items()
    ])

@app.route("/machine/<machine_id>", methods=["GET"])
def get_machine(machine_id):
    return jsonify(connected_machines.get(machine_id, {}))

@app.route("/block-ip", methods=["POST"])
def block_ip_route():
    ip = request.json.get("ip")
    if ip:
        ips_to_block.append(ip)
        return jsonify({"status": "queued", "ip": ip})
    return jsonify({"error": "no ip"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=5000)