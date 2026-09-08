from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from flask_bcrypt import Bcrypt
from langchain_ollama import OllamaLLM
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_chroma import Chroma
from langchain_mistralai import ChatMistralAI
from collections import Counter
from datetime import datetime
import sqlite3
import json
import os
import shutil
import subprocess
import threading
import time
import requests
import uuid
from langgraph.func import task
from werkzeug.utils import secure_filename
import csv
import io
from flask import Response
from dotenv import load_dotenv
import os
import sys

import asyncio
import edge_tts

ROOT_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)

if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

app = Flask(__name__)

DEPLOYED = os.getenv("DEPLOYED", "false").strip().lower() in ("1", "true", "yes")
OLLAMA_AVAILABLE = os.getenv("OLLAMA_AVAILABLE", "false").strip().lower() in ("1", "true", "yes")
DEFAULT_CLOUD_MODEL = os.getenv("DEFAULT_CLOUD_MODEL", "groq")

_default_origins = "http://localhost:3000,http://127.0.0.1:3000"
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()]

CORS(
    app,
    resources={r"/*": {"origins": ALLOWED_ORIGINS}},
    supports_credentials=True,
)

@app.route('/', methods=['GET', 'HEAD'])
def root():
    return jsonify({"service": "soc-copilot-backend", "status": "running"}), 200


app.config["JWT_SECRET_KEY"] = "soc-copilot-secret-key-2024"
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = False
jwt = JWTManager(app)
bcrypt = Bcrypt(app)

DB_PATH = os.path.join(os.path.dirname(__file__), 'users.db')

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
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
    conn.execute('''
        CREATE TABLE IF NOT EXISTS email_schedule (
            username        TEXT PRIMARY KEY,
            email           TEXT NOT NULL,
            scheduled_time  TEXT NOT NULL,
            enabled         INTEGER NOT NULL DEFAULT 1,
            last_sent_date  TEXT
        )
    ''')
    conn.commit()
    conn.close()
    print("SQLite database ready — users.db")

init_db()

try:
    from hermes_documents import documents_bp
    app.register_blueprint(documents_bp, url_prefix="/api/documents")
    print("Documents blueprint registered — /api/documents/* available")
except ImportError as e:
    print(f"Documents blueprint not loaded: {e}")

from ai.local_embeddings import LocalOllamaEmbeddings

try:
    embeddings = LocalOllamaEmbeddings()
    vectorstore = Chroma(
        persist_directory="../ai/chroma_db",
        embedding_function=embeddings
    )
    retriever = vectorstore.as_retriever(search_kwargs={"k": 10})
except Exception as e:
    print(f"[STARTUP] Embeddings/ChromaDB unavailable, retrieval will degrade gracefully: {e}")
    embeddings = None
    vectorstore = None
    retriever = None


_KNOWN_CLOUD_MODELS = {"groq", "gemini", "mistral"}


def _safe_cloud_default():
    value = (DEFAULT_CLOUD_MODEL or "").strip()
    return value if value in _KNOWN_CLOUD_MODELS else "groq"


def get_llm(model, api_key=None):
    SIRA_TEMPERATURE = 0.4
    SIRA_NUM_CTX = 8192

    if model == "ollama_phi4mini":
        return OllamaLLM(model="phi4-mini", temperature=SIRA_TEMPERATURE, num_ctx=SIRA_NUM_CTX), "local"
    elif model == "groq":
        return ChatGroq(
            model="openai/gpt-oss-120b",
            groq_api_key=api_key or os.getenv("GROQ_API_KEY"),
            temperature=SIRA_TEMPERATURE,
        ), "cloud"
    elif model == "gemini":
        return ChatGoogleGenerativeAI(
            model="gemini-3.5-flash",
            google_api_key=api_key or os.getenv("GEMINI_API_KEY"),
            temperature=SIRA_TEMPERATURE,
        ), "cloud"
    elif model == "mistral":
        return ChatMistralAI(
            model="mistral-small-latest",
            mistral_api_key=api_key or os.getenv("MISTRAL_API_KEY"),
            temperature=SIRA_TEMPERATURE,
        ), "cloud"
    elif model == "ollama":
        if DEPLOYED and not OLLAMA_AVAILABLE:
            return get_llm(_safe_cloud_default(), api_key)
        return OllamaLLM(model="sira-model", temperature=SIRA_TEMPERATURE, num_ctx=SIRA_NUM_CTX), "local"
    else:
        if DEPLOYED and not OLLAMA_AVAILABLE:
            return get_llm(_safe_cloud_default(), api_key)
        return OllamaLLM(model="sira-model", temperature=SIRA_TEMPERATURE, num_ctx=SIRA_NUM_CTX), "local"


def _is_rate_limit_error(err_msg):
    m = (err_msg or "").lower()
    return any(k in m for k in [
        "rate limit", "rate_limit", "429", "quota",
        "resourceexhausted", "resource_exhausted", "too many requests",
    ])


def _is_connection_error(err_msg):
    m = (err_msg or "").lower()
    return any(k in m for k in [
        "connection refused", "connecterror", "failed to connect",
        "max retries exceeded", "connection error", "econnrefused",
        "could not connect", "connection timed out",
    ])


_CLOUD_PROVIDER_PRIORITY = ["groq", "gemini", "mistral"]


def _invoke_llm(model, prompt, api_key=None, allow_fallback=True):
    llm, llm_type = get_llm(model, api_key)
    try:
        result = llm.invoke(prompt)
        answer = result if llm_type == "local" else result.content
        return answer, model, False
    except Exception as e:
        err_msg = str(e)
        should_try_fallback = allow_fallback and DEPLOYED and (_is_connection_error(err_msg) or _is_rate_limit_error(err_msg))
        if not should_try_fallback:
            raise

        candidates = [DEFAULT_CLOUD_MODEL] + [p for p in _CLOUD_PROVIDER_PRIORITY if p != DEFAULT_CLOUD_MODEL]
        candidates = [c for c in candidates if c != model]

        for candidate in candidates:
            try:
                fallback_llm, _ = get_llm(candidate, None)
                answer = fallback_llm.invoke(prompt).content
                return answer, candidate, True
            except Exception as fallback_err:
                fallback_msg = str(fallback_err)
                if _is_connection_error(fallback_msg) or _is_rate_limit_error(fallback_msg):
                    continue
                raise

        raise


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

    if len(logs) > MAX_CACHED_EVENTS:
        logs = logs[-MAX_CACHED_EVENTS:]

    _logs_cache["mtime"] = stat.st_mtime
    _logs_cache["size"] = stat.st_size
    _logs_cache["data"] = logs
    return logs


def _build_aggregate_stats_context():
    """Real counted stats over all logs -- independent of vector retrieval,
    so questions like 'summarize' or 'what IP is triggering alerts' always
    have the correct top-attacker/alert numbers available, even if semantic
    retrieval doesn't happen to surface those specific log entries."""
    logs = load_logs()
    alert_logs = [l for l in logs if l.get('event_type') == 'alert']
    ip_counts = Counter(l.get('src_ip') for l in alert_logs if l.get('src_ip'))
    top_ips = ip_counts.most_common(5)
    sig_counts = Counter(
        l.get('alert', {}).get('signature') for l in alert_logs
        if l.get('alert', {}).get('signature')
    )
    top_sigs = sig_counts.most_common(5)
    unique_ips = len(set(l.get('src_ip') for l in logs if l.get('src_ip')))

    lines = [
        f"VERIFIED AGGREGATE STATS (counted directly from all {len(logs)} log events, "
        f"{len(alert_logs)} of them alerts, across {unique_ips} unique source IPs -- "
        f"these are the correct numbers, use them for any 'how many', 'summarize', "
        f"or 'top attacker' style question instead of estimating from the log excerpts below):"
    ]
    if top_ips:
        lines.append("Top attacking IPs by alert count: " +
                      ", ".join(f"{ip} ({count} alerts)" for ip, count in top_ips))
    else:
        lines.append("No alerting source IPs currently in the log window.")
    if top_sigs:
        lines.append("Top alert signatures: " +
                      ", ".join(f"{sig} ({count}x)" for sig, count in top_sigs))
    return "\n".join(lines)


import re

def format_ts(ts):
    if not ts: return "unknown time"
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})', ts)
    if m: return f"{m.group(3)}/{m.group(2)}/{m.group(1)} at {m.group(4)}:{m.group(5)}"
    return ts


DEFAULT_VOICE = "en-GB-ThomasNeural"
DEFAULT_RATE = "-8%"
DEFAULT_PITCH = "-3Hz"

KNOWN_VOICES = [
    {"id": "en-GB-ThomasNeural", "label": "Thomas (British, calm)", "default": True},
    {"id": "en-GB-RyanNeural",   "label": "Ryan (British, precise)", "default": False},
]


async def _synthesize_speech(text, voice=None, rate=None, pitch=None):
    communicate = edge_tts.Communicate(
        text,
        voice or DEFAULT_VOICE,
        rate=rate or DEFAULT_RATE,
        pitch=pitch or DEFAULT_PITCH,
    )
    audio_bytes = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_bytes.extend(chunk["data"])
    return bytes(audio_bytes)


def get_speech_audio(text, voice=None, rate=None, pitch=None):
    return asyncio.run(_synthesize_speech(text, voice=voice, rate=rate, pitch=pitch))


@app.route("/voices", methods=["GET"])
def get_voices():
    return jsonify(KNOWN_VOICES)


@app.route("/sira-speak", methods=["POST"])
def sira_speak():
    text = request.json.get("text", "")
    voice = request.json.get("voice") or DEFAULT_VOICE
    rate = request.json.get("rate")
    pitch = request.json.get("pitch")
    if not text:
        return jsonify({"error": "no text"}), 400
    try:
        audio_bytes = get_speech_audio(text[:500], voice=voice, rate=rate, pitch=pitch)
        return Response(audio_bytes, mimetype="audio/mpeg")
    except Exception as e:
        return jsonify({"error": str(e)}), 500



import subprocess
import uuid

WAV2LIP_DIR = os.path.join(os.path.dirname(__file__), 'Wav2Lip')
WAV2LIP_PYTHON = os.path.join(WAV2LIP_DIR, 'venv', 'Scripts', 'python.exe')
WAV2LIP_CHECKPOINT = os.path.join('checkpoints', 'wav2lip_gan.pth')
WAV2LIP_FACE = os.path.join(WAV2LIP_DIR, 'sira_face.jpg')


@app.route('/sira-face-speak', methods=['POST'])
def sira_face_speak():
    text = request.json.get("text", "")
    voice = request.json.get("voice") or DEFAULT_VOICE
    if not text:
        return jsonify({"error": "no text"}), 400

    request_id = uuid.uuid4().hex[:8]
    audio_path = os.path.join(WAV2LIP_DIR, f"temp_audio_{request_id}.wav")
    video_path = os.path.join(WAV2LIP_DIR, f"temp_output_{request_id}.mp4")

    try:
        audio_bytes = get_speech_audio(text[:500], voice=voice)
        with open(audio_path, "wb") as f:
            f.write(audio_bytes)

        result = subprocess.run(
            [
                WAV2LIP_PYTHON, "inference.py",
                "--checkpoint_path", WAV2LIP_CHECKPOINT,
                "--face", WAV2LIP_FACE,
                "--audio", audio_path,
                "--outfile", video_path,
                "--pads", "0", "20", "0", "0",
                "--nosmooth",
                "--resize_factor", "4",
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


def _extract_spoken_summary(text):
    if not text:
        return text, ""
    marker = "SPOKEN_SUMMARY:"
    idx = text.rfind(marker)
    if idx == -1:
        return text, ""
    report = text[:idx].rstrip()
    spoken = text[idx + len(marker):].strip()
    if len(report) < 20 and len(spoken) > len(report) * 3:
        return text, ""
    return report, spoken


def _rewrite_followup_question(question, history):
    if not history:
        return question
    try:
        recent = "\n".join([f"{m['role'].upper()}: {m['content'][:300]}" for m in history[-4:] if m.get('content')])
        rewrite_prompt = f"""Given this recent conversation and a follow-up question, rewrite the follow-up into ONE fully self-contained question that includes any specific detail (IP address, signature name, number, etc.) it refers back to. If the follow-up is already self-contained, return it exactly unchanged. Reply with ONLY the rewritten question -- no explanation, no quotes.

Recent conversation:
{recent}

Follow-up question: {question}

Rewritten question:"""
        rewriter = OllamaLLM(model="phi4-mini", temperature=0, num_predict=80)
        rewritten = rewriter.invoke(rewrite_prompt).strip().strip('"').strip()
        return rewritten if rewritten else question
    except Exception:
        return question


_ask_request_count = 0

ask_activity = {
    "currently_processing": False,
    "recent_requests": [],
}
MAX_ASK_EVENTS = 15


def _log_ask_event(question, model, outcome):
    ask_activity["recent_requests"].append({
        "at": datetime.utcnow().isoformat() + "Z",
        "question_preview": (question or "")[:80],
        "model_requested": model,
        "outcome": outcome,
    })
    ask_activity["recent_requests"] = ask_activity["recent_requests"][-MAX_ASK_EVENTS:]


@app.after_request
def _clear_ask_processing_flag(response):
    if request.path == '/ask':
        ask_activity["currently_processing"] = False
    return response


@app.route('/ask', methods=['POST'])
def ask():
    global _ask_request_count
    _ask_request_count += 1
    ask_activity["currently_processing"] = True
    data        = request.json
    question    = data.get('question', '')
    model       = data.get('model', 'ollama')
    api_key     = data.get('api_key', None)
    date_filter = data.get('date', None)
    hour_filter = data.get('hour', None)
    history     = data.get('history', [])
    honorific   = (data.get('honorific') or 'Sir').strip()
    _log_ask_event(question, model, "received")

    if re.search(r'\b(who are you|what are you|what is sira|introduce yourself|what can you do|how do you work|tell me about yourself)\b', question, re.IGNORECASE):
        identity_prompt = f"""You are SIRA — Security Incident Response Assistant.
Speak like JARVIS from Iron Man: calm, precise, address the analyst as "{honorific}" occasionally.
The analyst asked: "{question}"
Answer conversationally in 2-4 sentences, describing who you are and what you help with
(monitoring Suricata/Zeek network traffic, triaging alerts, investigating threats via Hermes).
Do NOT perform log analysis, cite any IPs, or produce a security report for this message."""
        try:
            identity_answer, used_model, fell_back = _invoke_llm(model, identity_prompt, api_key)
        except Exception as e:
            err_msg = str(e)
            if any(k in err_msg.lower() for k in ["api key", "unauthorized", "401", "invalid_api_key", "authentication"]):
                return jsonify({"error": "Invalid API key for this provider. Check the key and try again."}), 401
            if _is_rate_limit_error(err_msg):
                return jsonify({"error": f"{model} is rate-limited right now. Try a different model."}), 429
            return jsonify({"error": f"Could not reach {model}: {err_msg[:200]}"}), 502
        resp = {'answer': identity_answer, 'model_used': used_model, 'spoken_summary': identity_answer}
        _log_ask_event(question, model, f"answered (identity) via {used_model}")
        if fell_back:
            resp['fallback_used'] = True
            resp['fallback_note'] = f"{model} wasn't reachable here, answered with {used_model} instead"
        return jsonify(resp)

    last_ai_text = ""
    for m in reversed(history):
        if m.get('role') in ('assistant', 'ai') and m.get('content'):
            last_ai_text = m['content']
            break

    resolved_question = _rewrite_followup_question(question, history)

    def _do_retrieval():
        docs = retriever.invoke(resolved_question)
        if last_ai_text:
            followup_docs = retriever.invoke(f"{last_ai_text[:400]} {resolved_question}")
            docs = followup_docs + docs

        if date_filter:
            docs = [d for d in docs if d.metadata.get('date') == date_filter]
        if hour_filter:
            docs = [d for d in docs if d.metadata.get('hour') == hour_filter]
        if not docs:
            docs = retriever.invoke(question)

        alert_docs = [d for d in docs if d.metadata.get('event_type') == 'alert']
        other_docs = [d for d in docs if d.metadata.get('event_type') != 'alert']
        docs = alert_docs + other_docs

        ip_match = re.findall(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', resolved_question)
        if not ip_match and last_ai_text:
            ip_match = re.findall(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', last_ai_text)
        confirmed_no_data_ips = []
        if ip_match:
            all_logs = load_logs()
            extra_docs = []
            for ip in ip_match:
                real_events = [l for l in all_logs if l.get('src_ip') == ip or l.get('dest_ip') == ip]
                if not real_events:
                    confirmed_no_data_ips.append(ip)
                    continue
                for e in real_events[:10]:
                    text = f"Event: {e.get('event_type','unknown')} | Time: {e.get('timestamp','unknown')}\nSource: {e.get('src_ip','')}:{e.get('src_port','?')} → Destination: {e.get('dest_ip','')}:{e.get('dest_port','?')}"
                    if e.get('event_type') == 'alert':
                        alert = e.get('alert', {})
                        text += f"\nAlert: {alert.get('signature','unknown')} | Severity: {alert.get('severity','?')} | Category: {alert.get('category','?')}"
                    extra_docs.append(type('Doc', (), {'page_content': text, 'metadata': {'src_ip': e.get('src_ip',''), 'dest_ip': e.get('dest_ip',''), 'event_type': e.get('event_type','')}})())
            docs = extra_docs + docs

        seen = set()
        unique_docs = []
        for d in docs:
            if d.page_content not in seen:
                seen.add(d.page_content)
                unique_docs.append(d)
        return unique_docs[:15], confirmed_no_data_ips

    docs, confirmed_no_data_ips = _call_with_timeout(_do_retrieval, 15, default=([], []))

    context = "\n\n".join([d.page_content for d in docs])
    context = re.sub(
    r'\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):\d{2}[.\d]*\+\d{4}',
    lambda m: f"at {m.group(1)}:{m.group(2)}",
    context
)

    aggregate_stats = _call_with_timeout(_build_aggregate_stats_context, 5, default="")
    if aggregate_stats:
        context = aggregate_stats + "\n\n" + context

    SIMPLE_PROMPT_MODELS = {"ollama_phi4mini", "ollama"}

    no_data_warning = ""
    if confirmed_no_data_ips:
        ip_list = ", ".join(confirmed_no_data_ips)
        no_data_warning = f"""

CONFIRMED: {ip_list} does NOT appear anywhere in the actual log data below. This was verified directly against the real data, not assumed. You MUST NOT describe any alerts, activity, signatures, ports, or timestamps for {ip_list} -- doing so would be fabrication, not analysis. Your answer must state plainly that no log data exists for {ip_list}, even if you have general knowledge about this IP from elsewhere -- that outside knowledge is NOT this deployment's log data and must not be presented as if it were."""

    if model in SIMPLE_PROMPT_MODELS:
        prompt = f"""You are SIRA — Security Incident Response Assistant. Speak calmly and precisely, like JARVIS from Iron Man, addressing the analyst as "{honorific}" occasionally. Answer the question below using ONLY the log data provided. Do not invent any IP address, CVE, signature, or event that is not shown here. Private/internal IP addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x) and known cloud platform IPs (168.63.129.16, 169.254.169.254) are internal infrastructure, not attackers -- never describe them as an attack. If there are no alert-severity events for an IP but it still shows significant non-alert traffic (flow/dns/http/tls), say so explicitly rather than just stating "zero alerts", since that alone can misleadingly imply no activity at all. If the log data below does not answer the question, say so plainly.{no_data_warning}

Log Data:
{context}

Question: {resolved_question}
{no_data_warning}

Remember: only use facts from the log data above. Give a genuinely complete answer with real supporting detail -- specific IPs, timestamps, signatures -- not just the shortest possible response.

After your answer, add one final line starting with SPOKEN_SUMMARY: followed by 1-2 short sentences that say the same thing as if you were talking to {honorific} out loud -- plain conversational language, no bullet points, no technical formatting, don't just re-read the answer above. Address {honorific} naturally once."""
    else:
        prompt = f"""You are SIRA — Security Incident Response Assistant.
Speak exactly like JARVIS from Iron Man. Calm, authoritative, precise.
Address the analyst as "{honorific}" occasionally.
Lead with the most critical information first, then give the supporting detail an analyst would actually need -- specific IPs, timestamps, signatures, patterns. Precise does not mean short: a complete, well-organised answer is more useful than a clipped one.
Be definitive — never say "I think" or "maybe".
Every sentence should carry real information, not padding -- but don't compress a genuinely detailed answer down to one line just to sound terse.
{no_data_warning}

STRICT RULES:
- Only use facts from the log data below — never invent details
- Write timestamps as "at HH:MM" not raw ISO format
- Always use exact IPs, timestamps, ports and alert names from the logs
- If information is missing say "Not available in logs"
- Write so a junior analyst with 3 months experience can understand
- VARY your response based on what is being asked — not every question needs 5 sections
- Private/internal IP addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x) and known cloud platform IPs (168.63.129.16, 169.254.169.254) are internal infrastructure traffic, not external attackers — even with a high event count. Never describe traffic from these as unauthorized access, an intrusion, or an attack, and never recommend blocking them.
- If there are no alert-severity events for an IP but that IP still shows significant non-alert traffic (flow/dns/http/tls), say so explicitly: e.g. "No alert-severity events for this IP, but it does show significant [type] traffic." Never just say "zero alerts" when real traffic exists — that reads as a flat contradiction next to anything showing total activity for that IP.
- If the retrieved log data below doesn't actually relate to the question asked, say so plainly instead of forcing it into a security-report structure

Previous conversation:
{chr(10).join([f"{m['role'].upper()}: {m['content']}" for m in history[-4:] if m.get('content')]) or "None"}

RESPONSE FORMAT RULES — read the question and pick the right format:

IF the question is simple (how many, list, count, what ports):
→ No headers needed, but give a genuinely complete answer, not just the bare number. Include relevant supporting detail: which specific IPs/signatures/times stand out, any pattern worth noting, and a brief note on what it means or what to check next. Several sentences, not one.
Example: "There are 171 alerts in total. The top attacker is 185.220.101.45 with 23 alerts, mostly brute-force attempts against SSH, followed by 45.33.32.156 with 12 port-scanning alerts. Both have been active within the last hour, which suggests this is ongoing rather than a one-off spike."

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

Question: {resolved_question}

Answer naturally. Pick the format that fits. Do not force sections that do not apply.

After everything above, add one final line starting with exactly SPOKEN_SUMMARY: followed by 1-2 short sentences that say the same thing as if you were speaking it out loud to {honorific} -- plain conversational language, no bullet points, no section headers, no re-reading the report above word for word, no repeating every IP/timestamp. Address {honorific} naturally once. This is the ONLY part of your response that will actually be spoken aloud -- the rest is read on screen."""

    try:
        answer, used_model, fell_back = _invoke_llm(model, prompt, api_key)
    except Exception as e:
        err_msg = str(e)
        if any(k in err_msg.lower() for k in ["api key", "unauthorized", "401", "invalid_api_key", "authentication"]):
            return jsonify({"error": "Invalid API key for this provider. Check the key and try again."}), 401
        if _is_rate_limit_error(err_msg):
            return jsonify({"error": f"{model} is rate-limited right now. Try a different model."}), 429
        return jsonify({"error": f"Could not reach {model}: {err_msg[:200]}"}), 502

    answer, spoken_summary = _extract_spoken_summary(answer)

    resp = {'answer': answer, 'model_used': used_model, 'spoken_summary': spoken_summary}
    _log_ask_event(question, model, f"answered via {used_model}" + (" (fallback)" if fell_back else ""))
    if fell_back:
        resp['fallback_used'] = True
        resp['fallback_note'] = f"{model} wasn't reachable here, answered with {used_model} instead"
    return jsonify(resp)


@app.route('/logs', methods=['GET'])
def get_logs():
    logs = load_logs()
    return jsonify(logs[:50])


@app.route('/logs/grouped', methods=['GET'])
def get_logs_grouped():
    logs = load_logs()
    groups = {}
    for l in logs:
        if l.get('event_type') != 'alert':
            continue
        alert = l.get('alert', {})
        sig = alert.get('signature', 'unknown')
        src = l.get('src_ip', '')
        dst = l.get('dest_ip', '')
        key = (sig, src, dst)
        ts = l.get('timestamp', '')

        if key not in groups:
            groups[key] = {
                "signature": sig,
                "src_ip": src,
                "dest_ip": dst,
                "category": alert.get('category', ''),
                "severity": alert.get('severity', ''),
                "count": 0,
                "first_seen": ts,
                "last_seen": ts,
            }
        g = groups[key]
        g["count"] += 1
        if ts:
            if not g["first_seen"] or ts < g["first_seen"]:
                g["first_seen"] = ts
            if not g["last_seen"] or ts > g["last_seen"]:
                g["last_seen"] = ts

    result = sorted(groups.values(), key=lambda g: g["count"], reverse=True)
    return jsonify(result[:100])


_MITRE_CATEGORY_PATTERNS = [
    (["scan", "reconnaissance"], "T1595", "Active Scanning"),
    (["brute force", "brute-force", "credential"], "T1110", "Brute Force"),
    (["web application attack", "sql injection", "xss", "cross site"], "T1190", "Exploit Public-Facing Application"),
    (["trojan", "malware", "ingress tool"], "T1105", "Ingress Tool Transfer"),
    (["denial of service", " dos ", "ddos"], "T1499", "Endpoint Denial of Service"),
    (["administrator privilege", "privilege escalation", "priv esc"], "T1068", "Exploitation for Privilege Escalation"),
    (["command and control", "c2 ", "c&c"], "T1071", "Application Layer Protocol"),
]


def _map_to_mitre(signature, category):
    haystack = f"{signature} {category}".lower()
    for keywords, technique_id, technique_name in _MITRE_CATEGORY_PATTERNS:
        if any(kw in haystack for kw in keywords):
            return {"technique_id": technique_id, "technique_name": technique_name}
    return None


@app.route('/logs/grouped-mitre', methods=['GET'])
def get_logs_grouped_mitre():
    logs = load_logs()
    groups = {}
    for l in logs:
        if l.get('event_type') != 'alert':
            continue
        alert = l.get('alert', {})
        sig = alert.get('signature', 'unknown')
        src = l.get('src_ip', '')
        dst = l.get('dest_ip', '')
        category = alert.get('category', '')
        key = (sig, src, dst)
        ts = l.get('timestamp', '')

        if key not in groups:
            groups[key] = {
                "signature": sig,
                "src_ip": src,
                "dest_ip": dst,
                "category": category,
                "severity": alert.get('severity', ''),
                "count": 0,
                "first_seen": ts,
                "last_seen": ts,
                "mitre": _map_to_mitre(sig, category),
            }
        g = groups[key]
        g["count"] += 1
        if ts:
            if not g["first_seen"] or ts < g["first_seen"]:
                g["first_seen"] = ts
            if not g["last_seen"] or ts > g["last_seen"]:
                g["last_seen"] = ts

    result = sorted(groups.values(), key=lambda g: g["count"], reverse=True)
    return jsonify(result[:100])


@app.route('/models', methods=['GET'])
def get_models():
    return jsonify([
        {"id": "ollama",          "name": "SIRA — qwen3:1.7b (local)",
         "chip": "sira-model (local)", "cloud": False, "requires_key": False},
        {"id": "ollama_phi4mini", "name": "Phi-4-mini 3.8B — bigger, smarter local option (local)",
         "chip": "phi4-mini (local)", "cloud": False, "requires_key": False},
        {"id": "groq",            "name": "Groq — GPT-OSS 120B (cloud)",
         "chip": "groq gpt-oss (cloud)", "cloud": True, "requires_key": False},
        {"id": "gemini",          "name": "Google Gemini 3.5 Flash (cloud)",
         "chip": "gemini 3.5 (cloud)", "cloud": True, "requires_key": False},
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


import concurrent.futures


def _ping_with_timeout(fn, timeout_seconds=5):
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = executor.submit(fn)
    try:
        future.result(timeout=timeout_seconds)
        result = (True, None)
    except concurrent.futures.TimeoutError:
        result = (False, "timed out")
    except Exception as e:
        result = (False, str(e)[:60])
    finally:
        executor.shutdown(wait=False)
    return result


def _call_with_timeout(fn, timeout_seconds, default=None):
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = executor.submit(fn)
    try:
        return future.result(timeout=timeout_seconds)
    except Exception:
        return default
    finally:
        executor.shutdown(wait=False)


@app.route('/health', methods=['GET'])
def health():
    flask_status = "ok"
    if DEPLOYED and not OLLAMA_AVAILABLE:
        ollama_status = "skipped (DEPLOYED=true, OLLAMA_AVAILABLE=false)"
    else:
        ok, err = _ping_with_timeout(lambda: OllamaLLM(model="sira-model").invoke("ping"), 20)
        ollama_status = "ok" if ok else f"offline — {err}"

    cloud_status = "not checked"
    if DEPLOYED:
        ok, err = _ping_with_timeout(lambda: get_llm(DEFAULT_CLOUD_MODEL)[0].invoke("ping"), 8)
        cloud_status = "ok" if ok else f"offline — {err}"

    ok, err = _ping_with_timeout(lambda: vectorstore.get(limit=1), 5)
    chroma_status = "ok" if ok else f"offline — {err}"

    llm_path_ok = (ollama_status == "ok") or (DEPLOYED and cloud_status == "ok")
    overall = "ok" if llm_path_ok and chroma_status == "ok" else "degraded"
    return jsonify({
        "status":   overall,
        "flask":    flask_status,
        "ollama":   ollama_status,
        "cloud":    cloud_status,
        "chromadb": chroma_status,
        "deployed": DEPLOYED,
    })


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

    return jsonify(logs[:100])


@app.route('/timeline', methods=['GET'])
def timeline():
    logs = load_logs()
    hourly = Counter()
    for l in logs:
        ts = l.get('timestamp', '')
        if len(ts) >= 13:
            hour = ts[11:13]
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


_geoip_cache = {}


def _lookup_geoip(ip):
    if ip in _geoip_cache:
        return _geoip_cache[ip]
    try:
        resp = requests.get(
            f"http://ip-api.com/json/{ip}",
            params={"fields": "status,country,countryCode,city,lat,lon,isp"},
            timeout=5,
        )
        data = resp.json()
        if data.get("status") == "success":
            result = {
                "country": data.get("country"),
                "country_code": data.get("countryCode"),
                "city": data.get("city"),
                "lat": data.get("lat"),
                "lon": data.get("lon"),
                "isp": data.get("isp"),
            }
        else:
            result = None
    except Exception:
        result = None
    _geoip_cache[ip] = result
    return result


@app.route('/geoip/top-ips', methods=['GET'])
def geoip_top_ips():
    logs = load_logs()
    limit = int(request.args.get('limit', 15))
    ip_counts = Counter(l.get('src_ip') for l in logs if l.get('src_ip'))
    result = []
    for ip, count in ip_counts.most_common(limit):
        geo = _lookup_geoip(ip)
        if geo:
            result.append({"ip": ip, "count": count, **geo})
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


@app.route('/attention-items', methods=['GET'])
def attention_items():
    from ai.hermes_agent import _is_internal_or_platform_ip

    items = []

    logs = load_logs()
    ip_counts = Counter(
        l.get('src_ip') for l in logs
        if l.get('src_ip') and not _is_internal_or_platform_ip(l.get('src_ip'))
    )
    if ip_counts:
        top_ip, top_count = ip_counts.most_common(1)[0]
        items.append({
            "priority": "high",
            "type": "top_attacker",
            "title": f"{top_ip} is the top external attacker",
            "detail": f"{top_count} events in current log window",
            "ip": top_ip,
        })

    try:
        conn = get_db()
        pending = conn.execute(
            "SELECT COUNT(*) AS c FROM pending_actions WHERE status = 'pending'"
        ).fetchone()
        conn.close()
        pending_count = pending['c'] if pending else 0
        if pending_count > 0:
            items.append({
                "priority": "high",
                "type": "pending_actions",
                "title": f"{pending_count} action{'s' if pending_count != 1 else ''} awaiting approval",
                "detail": "Proposed by Hermes, not yet executed",
            })
    except Exception:
        pass

    try:
        conn = get_db()
        flagged = conn.execute(
            "SELECT COUNT(*) AS c FROM sentinel_machines WHERE alert = 1"
        ).fetchone()
        conn.close()
        flagged_count = flagged['c'] if flagged else 0
        if flagged_count > 0:
            items.append({
                "priority": "medium",
                "type": "flagged_endpoints",
                "title": f"{flagged_count} Sentinel endpoint{'s' if flagged_count != 1 else ''} flagged",
                "detail": "Suspicious outbound connection detected",
            })
    except Exception:
        pass

    try:
        rres = requests.get(f"http://127.0.0.1:{os.getenv('PORT', '5000')}/rustinel-alerts", params={"limit": 5}, timeout=3)
        rustinel_alerts = rres.json()
        if rustinel_alerts:
            items.append({
                "priority": "high",
                "type": "rustinel_detections",
                "title": f"{len(rustinel_alerts)} recent Rustinel EDR detection{'s' if len(rustinel_alerts) != 1 else ''}",
                "detail": rustinel_alerts[0].get('rule_name', '') if rustinel_alerts else "",
            })
    except Exception:
        pass

    alert_count = sum(1 for l in logs if l.get('event_type') == 'alert')
    if alert_count > 0:
        items.append({
            "priority": "low",
            "type": "alert_volume",
            "title": f"{alert_count} total alerts in current log window",
            "detail": f"Across {len(ip_counts)} unique external source IPs",
        })

    priority_order = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda i: priority_order.get(i["priority"], 3))
    return jsonify(items[:5])


@app.route('/attacker-timeline/<ip>', methods=['GET'])
def attacker_timeline(ip):
    logs = load_logs()
    events = [l for l in logs if l.get('src_ip') == ip or l.get('dest_ip') == ip]
    events.sort(key=lambda l: l.get('timestamp', ''))

    timeline = []
    for e in events:
        entry = {
            "timestamp": e.get('timestamp', ''),
            "event_type": e.get('event_type', ''),
            "src_ip": e.get('src_ip', ''),
            "dest_ip": e.get('dest_ip', ''),
            "dest_port": e.get('dest_port', ''),
            "proto": e.get('proto', ''),
        }
        if e.get('event_type') == 'alert':
            alert = e.get('alert', {})
            entry["signature"] = alert.get('signature', '')
            entry["severity"] = alert.get('severity', '')
        elif e.get('event_type') == 'dns':
            entry["query"] = e.get('dns', {}).get('rrname', '')
        elif e.get('event_type') == 'http':
            http = e.get('http', {})
            entry["method"] = http.get('http_method', '')
            entry["hostname"] = http.get('hostname', '')
        timeline.append(entry)

    return jsonify({"ip": ip, "total_events": len(timeline), "timeline": timeline[:200]})


def _run_rag_rebuild():
    rag_script = os.path.join(os.path.dirname(__file__), '..', 'ai', 'rag_setup.py')
    ai_dir = os.path.join(os.path.dirname(__file__), '..', 'ai')
    result = subprocess.run(
        [sys.executable, rag_script], timeout=600,
        cwd=ai_dir, capture_output=True, text=True,
    )
    if result.stdout:
        print(f"[rag_setup stdout]\n{result.stdout}")
    if result.stderr:
        print(f"[rag_setup stderr]\n{result.stderr}")
    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "").strip().splitlines()[-8:]
        raise RuntimeError(f"rag_setup.py exited {result.returncode}: " + " | ".join(tail))


@app.route('/rebuild-index', methods=['POST'])
def rebuild_index():
    eve_path = os.path.join(os.path.dirname(__file__), '..', 'logs', 'eve.json')
    if not os.path.exists(eve_path) or os.path.getsize(eve_path) == 0:
        return jsonify({"error": "logs/eve.json doesn't exist or is empty yet -- honeypot sync may not have pulled data yet. Check /health or wait a moment and retry."}), 409
    if index_rebuild_status.get("in_progress"):
        return jsonify({"message": "A rebuild is already in progress -- check /pipeline-status for progress instead of starting another."}), 202

    def _background_manual_rebuild():
        try:
            index_rebuild_status["in_progress"] = True
            _log_rebuild_event("started", "manual rebuild via /rebuild-index")
            _run_rag_rebuild()
            index_rebuild_status["in_progress"] = False
            index_rebuild_status["last_rebuilt_at"] = datetime.utcnow().isoformat() + "Z"
            index_rebuild_status["last_event_count"] = len(load_logs())
            index_rebuild_status["last_error"] = None
            _log_rebuild_event("completed", f"{index_rebuild_status['last_event_count']} events indexed (manual)")
        except Exception as e:
            index_rebuild_status["in_progress"] = False
            index_rebuild_status["last_error"] = str(e)[:200]
            _log_rebuild_event("error", str(e)[:150])

    threading.Thread(target=_background_manual_rebuild, daemon=True, name="manual-rebuild").start()
    return jsonify({
        "message": "Rebuild started in the background -- check /pipeline-status for progress and completion, this response does not wait for it to finish."
    }), 202


@app.route('/pipeline-status', methods=['GET'])
def pipeline_status():
    try:
        from ai.honeypot_log_sync import sync_status as honeypot_sync_status
    except Exception:
        honeypot_sync_status = {"connected": False, "last_connected_at": None, "last_pull_at": None, "last_pull_bytes": 0, "last_error": "module not loaded", "currently_active": False, "recent_events": []}

    logs = load_logs()
    chroma_ok, _ = _ping_with_timeout(lambda: vectorstore.get(limit=1), 5) if vectorstore else (False, "not configured")

    event_breakdown = {}
    for l in logs:
        et = l.get('event_type', 'unknown')
        event_breakdown[et] = event_breakdown.get(et, 0) + 1

    return jsonify({
        "honeypot_sync": honeypot_sync_status,
        "index_rebuild": index_rebuild_status,
        "chat_activity": ask_activity,
        "chromadb_reachable": chroma_ok,
        "current_indexed_events": len(logs),
        "current_event_breakdown": event_breakdown,
        "total_ask_requests_served": _ask_request_count,
        "deployed": DEPLOYED,
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

    save_as = 'eve.json' if filename.endswith('.json') else 'conn.log'
    save_path = os.path.join(os.path.dirname(__file__), '..', 'logs', save_as)

    backup_path = save_path + '.bak'
    if os.path.exists(save_path):
        shutil.copy(save_path, backup_path)

    file.save(save_path)

    try:
        _run_rag_rebuild()
        new_logs = load_logs()
        return jsonify({
            "message": f"{save_as} uploaded and ChromaDB rebuilt successfully",
            "events_loaded": len(new_logs)
        })
    except subprocess.TimeoutExpired:
        return jsonify({"error": "ChromaDB rebuild timed out"}), 500
    except RuntimeError as e:
        return jsonify({"error": f"ChromaDB rebuild failed: {str(e)}"}), 500


@app.route('/export', methods=['GET'])
def export():
    logs = load_logs()
    event_type = request.args.get('type', None)
    query = request.args.get('q', '').strip()

    if query:
        logs = [l for l in logs if
                query in l.get('src_ip', '') or
                query in l.get('dest_ip', '') or
                query in l.get('alert', {}).get('signature', '')]
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

    docs = _call_with_timeout(lambda: retriever.invoke(question), 15, default=[])
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
        ("groq",   ChatGroq(model="openai/gpt-oss-120b", groq_api_key=os.getenv("GROQ_API_KEY"), temperature=0)),
        ("gemini", ChatGoogleGenerativeAI(model="gemini-3.5-flash", google_api_key=os.getenv("GEMINI_API_KEY"), temperature=0)),
        ("mistral",ChatMistralAI(model="mistral-small-latest", mistral_api_key=os.getenv("MISTRAL_API_KEY"))),
    ]

    for name, llm in models_to_try:
        try:
            results[name] = llm.invoke(prompt).content
        except Exception as e:
            results[name] = f"Error: {str(e)[:100]}"

    return jsonify(results)


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


from ai.rustinel_reader import load_rustinel_alerts


@app.route('/rustinel-alerts', methods=['GET'])
def rustinel_alerts():
    limit = min(int(request.args.get('limit', 50)), 500)
    alerts = load_rustinel_alerts()
    return jsonify(alerts[:limit])


@app.route('/attacker-profile/<ip>', methods=['GET'])
def attacker_profile(ip):
    import requests as req
    honorific = (request.args.get('honorific') or 'Sir').strip()
    requested_model = (request.args.get('model') or 'ollama').strip()

    logs = load_logs()
    events = [l for l in logs if l.get('src_ip') == ip or l.get('dest_ip') == ip]
    alerts = [e for e in events if e.get('event_type') == 'alert']

    abuse_data = {}
    try:
        r = req.get("https://api.abuseipdb.com/api/v2/check",
            headers={"Key": os.getenv("ABUSEIPDB_API_KEY"), "Accept": "application/json"},
            params={"ipAddress": ip, "maxAgeInDays": 90})
        abuse_data = r.json().get("data", {})
    except: pass

    geo = {}
    try:
        r = req.get(f"http://ip-api.com/json/{ip}", timeout=5)
        geo = r.json()
    except: pass

    signatures = list(set(e.get('alert', {}).get('signature', '') for e in alerts if e.get('alert')))
    ports = list(set(str(e.get('dest_port', '')) for e in events if e.get('dest_port')))

    docs = _call_with_timeout(lambda: retriever.invoke(f"attacks from {ip}"), 15, default=[])
    context = "\n\n".join([d.page_content for d in docs[:8]])

    no_real_data = len(events) == 0
    no_data_instruction = "" if not no_real_data else f"""

CONFIRMED: {ip} has ZERO real events anywhere in the actual logs -- verified directly, not assumed. Do NOT invent a threat classification, tactics, or danger level for an attacker that has no real recorded activity. Instead respond with exactly:

THREAT ACTOR TYPE:
No data — {ip} does not appear in current log data.

LIKELY INTENT:
Cannot be assessed — no recorded activity for this IP.

TACTICS:
- No real events available to analyse.

DANGER LEVEL:
UNKNOWN — no basis for a rating without real activity data.

RECOMMENDED BLOCK:
NO — insufficient evidence to justify blocking an IP with no observed activity."""

    prompt = f"""You are SIRA — speak like JARVIS from Iron Man. Calm, authoritative, precise. Address the analyst as {honorific} occasionally. Based on the log data, create a threat actor profile for IP {ip}.
Log context:
{context}

Attack signatures seen: {', '.join(signatures[:5]) or 'None'}
Ports targeted: {', '.join(ports[:10]) or 'Unknown'}
AbuseIPDB score: {abuse_data.get('abuseConfidenceScore', 'Unknown')}
Country: {geo.get('country', 'Unknown')}
{no_data_instruction}

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
        sira_assessment, used_model, _ = _invoke_llm(requested_model, prompt)
    except Exception:
        # Requested model failed -- fall back to local rather than
        # returning nothing, same pattern /ask uses.
        try:
            sira_assessment, used_model, _ = _invoke_llm("ollama", prompt)
        except Exception:
            sira_assessment = "SIRA offline — manual review required"
            used_model = requested_model

    return jsonify({
        "ip": ip,
        "model_used": used_model,
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
    honorific = (data.get('honorific') or 'Sir').strip()

    docs = _call_with_timeout(lambda: retriever.invoke(f"{alert_signature} {src_ip}"), 15, default=[])
    context = "\n\n".join([d.page_content for d in docs[:8]])

    prompt = f"""You are SIRA. Respond like JARVIS — calm, authoritative, precise. Address the analyst as {honorific} occasionally."

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
        answer, _, _ = _invoke_llm("ollama", prompt)
    except Exception as e:
        answer = f"Error: {str(e)}"

    return jsonify({"answer": answer, "signature": alert_signature, "src_ip": src_ip})


@app.route('/hermes-agent', methods=['POST'])
def hermes_agent():
    data = request.json
    task  = data.get('task', '').strip()
    model = data.get('model', 'nous-hermes2')
    if not task:
        return jsonify({"error": "No task provided"}), 400

    try:
        from ai.hermes_agent import run_hermes_agent, set_flask_client
        set_flask_client(app.test_client())
        result = run_hermes_agent(task, model=model)
        return jsonify(result)
    except Exception as e:
        err_msg = str(e)
        if DEPLOYED and _is_connection_error(err_msg):
            try:
                from ai.hermes_agent import run_hermes_agent as _retry, set_flask_client as _set_client_retry
                _set_client_retry(app.test_client())
                result = _retry(task, model=DEFAULT_CLOUD_MODEL)
                result["fallback_used"] = True
                result["fallback_note"] = f"{model} wasn't reachable here, ran with {DEFAULT_CLOUD_MODEL} instead"
                return jsonify(result)
            except Exception:
                pass

        import traceback
        traceback.print_exc()
        return jsonify({
            "error": f"{type(e).__name__}: {e}",
            "hint": "Check the Flask console for the full traceback.",
        }), 500


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


def init_actions_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS pending_actions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            action_type TEXT NOT NULL,
            target      TEXT NOT NULL,
            machine_id  TEXT,
            reason      TEXT,
            status      TEXT DEFAULT 'pending',
            created_at  TEXT,
            executed_at TEXT,
            result      TEXT
        )
    ''')
    conn.commit()
    conn.close()

init_actions_db()


def _execute_add_suricata_rule(rule_text):
    import paramiko
    from ai.honeypot_log_sync import HONEYPOT_HOST, HONEYPOT_USER, HONEYPOT_KEY_PATH
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(hostname=HONEYPOT_HOST, username=HONEYPOT_USER,
                        key_filename=HONEYPOT_KEY_PATH, timeout=10)
        safe_rule = rule_text.replace("'", "'\\''")
        cmd = f"echo '{safe_rule}' | sudo tee -a /etc/suricata/rules/custom.rules"
        stdin, stdout, stderr = client.exec_command(cmd)
        exit_code = stdout.channel.recv_exit_status()
        if exit_code != 0:
            return False, f"Failed to write rule: {stderr.read().decode()[:300]}"
        client.exec_command("sudo kill -HUP $(cat /run/suricata.pid)")
        return True, "Rule added to custom.rules and Suricata reloaded"
    except Exception as e:
        return False, str(e)[:300]
    finally:
        client.close()


DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "").strip()


def _send_webhook_alert(message):
    if not DISCORD_WEBHOOK_URL:
        return
    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"content": message}, timeout=5)
    except Exception as e:
        print(f"[webhook] failed to send alert: {e}")


@app.route('/propose-action', methods=['POST'])
def propose_action():
    data = request.json or {}
    action_type = data.get('action_type')
    target      = data.get('target', '').strip()
    reason      = data.get('reason', '').strip()
    machine_id  = data.get('machine_id')

    valid_types = {'block_ip', 'isolate_endpoint', 'restart_service', 'add_suricata_rule'}
    if action_type not in valid_types:
        return jsonify({"error": f"action_type must be one of {sorted(valid_types)}"}), 400
    if not target:
        return jsonify({"error": "target is required"}), 400

    conn = get_db()
    cur = conn.execute(
        "INSERT INTO pending_actions (action_type, target, machine_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
        (action_type, target, machine_id, reason, datetime.utcnow().isoformat() + "Z")
    )
    conn.commit()
    action_id = cur.lastrowid
    conn.close()

    _send_webhook_alert(
        f"🛡️ **SIRA proposed action #{action_id}**: {action_type} on `{target}`\n{reason}\n"
        f"Awaiting approval in the dashboard."
    )

    return jsonify({"id": action_id, "status": "pending"}), 201


@app.route('/pending-actions', methods=['GET'])
def list_pending_actions():
    status_filter = request.args.get('status')
    conn = get_db()
    if status_filter:
        rows = conn.execute("SELECT * FROM pending_actions WHERE status = ? ORDER BY id DESC", (status_filter,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM pending_actions ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/pending-actions/<int:action_id>/approve', methods=['POST'])
def approve_pending_action(action_id):
    try:
        conn = get_db()
        row = conn.execute("SELECT * FROM pending_actions WHERE id = ?", (action_id,)).fetchone()
        if not row:
            conn.close()
            return jsonify({"error": "not found"}), 404
        if row["status"] != "pending":
            conn.close()
            return jsonify({"error": f"action is already {row['status']}, not pending"}), 400

        action_type = row["action_type"]
        target = row["target"]
        now = datetime.utcnow().isoformat() + "Z"

        if action_type == "block_ip":
            conn.execute("INSERT INTO sentinel_block_queue (ip) VALUES (?)", (target,))
            conn.execute("UPDATE pending_actions SET status='executed', executed_at=?, result=? WHERE id=?",
                         (now, "Queued for next Sentinel check-in", action_id))
            conn.commit()
            conn.close()
            return jsonify({"status": "executed", "detail": "Queued for next Sentinel check-in"})

        elif action_type == "add_suricata_rule":
            ok, detail = _execute_add_suricata_rule(target)
            conn.execute("UPDATE pending_actions SET status=?, executed_at=?, result=? WHERE id=?",
                         ("executed" if ok else "failed", now, detail, action_id))
            conn.commit()
            conn.close()
            return jsonify({"status": "executed" if ok else "failed", "detail": detail})

        elif action_type in ("isolate_endpoint", "restart_service"):
            conn.execute("UPDATE pending_actions SET status='approved', executed_at=?, result=? WHERE id=?",
                         (now, "Approved -- execution for this action type is not yet implemented on the endpoint agent", action_id))
            conn.commit()
            conn.close()
            return jsonify({"status": "approved", "detail": "Approved, but endpoint-agent execution isn't wired up yet for this action type"})

        conn.close()
        return jsonify({"error": "unknown action_type"}), 400
    except Exception as e:
        return jsonify({"error": f"Could not approve action: {e}"}), 500


@app.route('/pending-actions/<int:action_id>/reject', methods=['POST'])
def reject_pending_action(action_id):
    try:
        conn = get_db()
        row = conn.execute("SELECT * FROM pending_actions WHERE id = ?", (action_id,)).fetchone()
        if not row:
            conn.close()
            return jsonify({"error": "not found"}), 404
        conn.execute("UPDATE pending_actions SET status='rejected' WHERE id=?", (action_id,))
        conn.commit()
        conn.close()
        return jsonify({"status": "rejected"})
    except Exception as e:
        return jsonify({"error": f"Could not reject action: {e}"}), 500



SUSPICIOUS_PORTS = {
    4444, 1337, 31337, 6667, 6666, 12345, 54321, 9001, 4443, 8888
}

def detect_suspicious(connections):
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


TSC_CATEGORIES = {
    "security":              "Security",
    "availability":          "Availability",
    "confidentiality":       "Confidentiality",
    "processing_integrity":  "Processing Integrity",
    "privacy":               "Privacy",
}

def _log_date_hour(ts):
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

    if DEPLOYED and not OLLAMA_AVAILABLE:
        ollama_ok = False
    else:
        ollama_ok, _ = _ping_with_timeout(lambda: OllamaLLM(model="sira-model").invoke("ping"), 20)
    cloud_ok = None
    if DEPLOYED:
        cloud_ok, _ = _ping_with_timeout(lambda: get_llm(DEFAULT_CLOUD_MODEL)[0].invoke("ping"), 8)
    chroma_ok, _ = _ping_with_timeout(lambda: vectorstore.get(limit=1), 5)

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
        "cloud_ok": cloud_ok,
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
         "description": "SIRA's LLM (local or cloud) and vector store are reachable.",
         "status": status(
             (ctx["ollama_ok"] or ctx["cloud_ok"] is True) and ctx["chroma_ok"],
             ctx["ollama_ok"] or ctx["cloud_ok"] is True or ctx["chroma_ok"],
         )},
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


_index_rebuild_started = False

index_rebuild_status = {
    "in_progress": False,
    "last_rebuilt_at": None,
    "last_event_count": None,
    "last_error": None,
    "recent_events": [],
}

MAX_REBUILD_EVENTS = 15


def _log_rebuild_event(event_type, detail):
    index_rebuild_status["recent_events"].append({
        "at": datetime.utcnow().isoformat() + "Z",
        "type": event_type,
        "detail": detail,
    })
    index_rebuild_status["recent_events"] = index_rebuild_status["recent_events"][-MAX_REBUILD_EVENTS:]


def _index_rebuild_loop():
    eve_path = os.path.join(os.path.dirname(__file__), '..', 'logs', 'eve.json')

    for _ in range(30):
        if os.path.exists(eve_path) and os.path.getsize(eve_path) > 0:
            break
        time.sleep(10)

    REBUILD_INTERVAL_SECONDS = 2 * 60 * 60
    while True:
        try:
            if os.path.exists(eve_path) and os.path.getsize(eve_path) > 0:
                print("[index_rebuild] starting ChromaDB rebuild from live honeypot data...")
                index_rebuild_status["in_progress"] = True
                _log_rebuild_event("started", "rebuild from logs/eve.json")
                _run_rag_rebuild()
                index_rebuild_status["in_progress"] = False
                index_rebuild_status["last_rebuilt_at"] = datetime.utcnow().isoformat() + "Z"
                index_rebuild_status["last_event_count"] = len(load_logs())
                index_rebuild_status["last_error"] = None
                _log_rebuild_event("completed", f"{index_rebuild_status['last_event_count']} events indexed")
                print("[index_rebuild] rebuild complete")
            else:
                print("[index_rebuild] logs/eve.json still not available -- skipping this cycle")
        except Exception as e:
            index_rebuild_status["in_progress"] = False
            index_rebuild_status["last_error"] = str(e)[:200]
            _log_rebuild_event("error", str(e)[:150])
            print(f"[index_rebuild] rebuild failed: {e} -- will retry next cycle")
        time.sleep(REBUILD_INTERVAL_SECONDS)


def _build_daily_summary_content():
    logs = load_logs()
    alert_logs = [l for l in logs if l.get("event_type") == "alert"]

    ip_counts = {}
    for l in alert_logs:
        ip = l.get("src_ip")
        if ip:
            ip_counts[ip] = ip_counts.get(ip, 0) + 1
    top_ips = sorted(ip_counts.items(), key=lambda x: -x[1])[:5]

    sig_counts = {}
    for l in alert_logs:
        sig = l.get("alert", {}).get("signature")
        if sig:
            sig_counts[sig] = sig_counts.get(sig, 0) + 1
    top_sigs = sorted(sig_counts.items(), key=lambda x: -x[1])[:5]

    lines = []
    lines.append("SUMMARY")
    lines.append(f"This automated daily report covers {len(logs)} total events "
                 f"and {len(alert_logs)} alerts currently in the index, across "
                 f"{len(ip_counts)} distinct source IPs that triggered at least one alert.")

    lines.append("TOP THREATS")
    if top_ips:
        for ip, count in top_ips:
            lines.append(f"{ip} -- {count} alert(s)")
    else:
        lines.append("No alerting source IPs in the current data.")

    lines.append("PATTERNS DETECTED")
    if top_sigs:
        for sig, count in top_sigs:
            lines.append(f"{sig} -- seen {count} time(s)")
    else:
        lines.append("No repeated signatures in the current data.")

    lines.append("RECOMMENDED ACTIONS")
    lines.append("1. Review any items in Pending Actions that are still awaiting approval.")
    lines.append("2. Investigate the top source IPs listed above if they are new or unexpected.")
    lines.append("3. Confirm the honeypot sync and ChromaDB index are both current via the Pipeline page.")

    return "\n\n".join(lines)


def _send_scheduled_report(email):
    from hermes_documents import _build_pdf
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.mime.base import MIMEBase
    from email import encoders as email_encoders

    content = _build_daily_summary_content()
    title = f"SIRA Daily Report — {datetime.utcnow().strftime('%d %B %Y')}"
    pdf_buf = _build_pdf(title, content, analyst="Automated Daily Report", model="scheduled")

    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", 587))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    from_email = os.environ.get("SMTP_FROM", smtp_user)
    if not all([smtp_host, smtp_user, smtp_pass]):
        print("[email_schedule] SMTP not configured -- skipping scheduled send")
        return False

    msg = MIMEMultipart()
    msg["From"] = from_email
    msg["To"] = email
    msg["Subject"] = title
    msg.attach(MIMEText("Your scheduled SIRA daily report is attached.", "plain"))
    attachment = MIMEBase("application", "pdf")
    attachment.set_payload(pdf_buf.read())
    email_encoders.encode_base64(attachment)
    attachment.add_header("Content-Disposition", "attachment; filename=SIRA_Daily_Report.pdf")
    msg.attach(attachment)

    try:
        import smtplib
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(from_email, email, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"[email_schedule] failed to send to {email}: {e}")
        return False


def _email_schedule_loop():
    while True:
        try:
            now = datetime.utcnow()
            current_hhmm = now.strftime("%H:%M")
            today = now.strftime("%Y-%m-%d")

            conn = get_db()
            due = conn.execute(
                "SELECT username, email FROM email_schedule "
                "WHERE enabled = 1 AND scheduled_time = ? "
                "AND (last_sent_date IS NULL OR last_sent_date != ?)",
                (current_hhmm, today)
            ).fetchall()

            for row in due:
                sent = _send_scheduled_report(row["email"])
                if sent:
                    conn.execute(
                        "UPDATE email_schedule SET last_sent_date = ? WHERE username = ?",
                        (today, row["username"])
                    )
                    conn.commit()
                    print(f"[email_schedule] sent daily report to {row['email']}")
            conn.close()
        except Exception as e:
            print(f"[email_schedule] loop error (will retry next cycle): {e}")
        time.sleep(60)


_email_scheduler_started = False


def _maybe_start_email_scheduler():
    global _email_scheduler_started
    if _email_scheduler_started:
        return
    _email_scheduler_started = True
    thread = threading.Thread(target=_email_schedule_loop, daemon=True, name="email-scheduler")
    thread.start()
    print("[email_schedule] background scheduler thread started")


@app.route('/email-schedule', methods=['GET'])
def get_email_schedule():
    username = request.args.get('username', 'unknown')
    conn = get_db()
    row = conn.execute("SELECT * FROM email_schedule WHERE username = ?", (username,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"enabled": False, "email": "", "scheduled_time": "09:00"})
    return jsonify(dict(row))


@app.route('/email-schedule', methods=['POST'])
def set_email_schedule():
    data = request.get_json(force=True) or {}
    username = data.get('username', 'unknown')
    email = (data.get('email') or '').strip()
    scheduled_time = (data.get('scheduled_time') or '09:00').strip()
    enabled = 1 if data.get('enabled') else 0

    if enabled and not email:
        return jsonify({"error": "An email address is required to enable daily reports"}), 400
    if not re.match(r'^\d{2}:\d{2}$', scheduled_time):
        return jsonify({"error": "scheduled_time must be in HH:MM format"}), 400

    conn = get_db()
    conn.execute(
        "INSERT INTO email_schedule (username, email, scheduled_time, enabled, last_sent_date) "
        "VALUES (?, ?, ?, ?, NULL) "
        "ON CONFLICT(username) DO UPDATE SET email=?, scheduled_time=?, enabled=?",
        (username, email, scheduled_time, enabled, email, scheduled_time, enabled)
    )
    conn.commit()
    conn.close()
    return jsonify({"status": "saved", "email": email, "scheduled_time": scheduled_time, "enabled": bool(enabled)})


def _maybe_start_index_rebuild():
    global _index_rebuild_started
    if _index_rebuild_started:
        return
    _index_rebuild_started = True
    thread = threading.Thread(target=_index_rebuild_loop, daemon=True, name="chromadb-index-rebuild")
    thread.start()
    print("[index_rebuild] background rebuild thread started")


_honeypot_sync_started = False


def _maybe_start_honeypot_sync():
    global _honeypot_sync_started
    if _honeypot_sync_started:
        return
    _honeypot_sync_started = True
    from ai.honeypot_log_sync import start_background_sync
    start_background_sync()


if __name__ != '__main__':
    _maybe_start_honeypot_sync()
    _maybe_start_index_rebuild()
    _maybe_start_email_scheduler()


if __name__ == '__main__':
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        _maybe_start_honeypot_sync()
        _maybe_start_index_rebuild()
        _maybe_start_email_scheduler()

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