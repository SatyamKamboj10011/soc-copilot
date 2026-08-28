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
import uuid
from langgraph.func import task
from werkzeug.utils import secure_filename
import csv
import io
from flask import Response
from dotenv import load_dotenv
import os
import sys

# Voice: edge-tts (Microsoft Edge's speech API, zero local model files,
# zero GPU/RAM overhead) -- replaces Kokoro, which needed two large model
# files that don't exist on any deploy target and forced a whole Docker
# detour just to host them. See get_speech_audio() below.
import asyncio
import edge_tts

ROOT_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)

if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

app = Flask(__name__)

# ── Deployment config ────────────────────────────────────────────────────
# DEPLOYED gates defaults and failure-recovery behaviour ONLY -- every model
# option (local Ollama variants and cloud) stays selectable everywhere,
# always. Setting DEPLOYED=true on Render doesn't remove sira-model or
# nous-hermes2 from the UI -- it just means "if nothing local is actually
# reachable, recover to a cloud model instead of hard-failing" and "when
# the frontend hasn't specified a model, default to one that will actually
# work here." Running locally with DEPLOYED unset (the default) behaves
# exactly as before: everything defaults to local Ollama, no fallback logic
# ever triggers.
DEPLOYED = os.getenv("DEPLOYED", "false").strip().lower() in ("1", "true", "yes")
DEFAULT_CLOUD_MODEL = os.getenv("DEFAULT_CLOUD_MODEL", "groq")

# Comma-separated list, e.g. "https://soc-copilot.vercel.app,http://localhost:3000"
# Falls back to the original localhost-only origins when unset, so local
# dev needs no env changes at all.
_default_origins = "http://localhost:3000,http://127.0.0.1:3000"
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()]

CORS(
    app,
    resources={r"/*": {"origins": ALLOWED_ORIGINS}},
    supports_credentials=True,
)

# Render's platform-level health check hits "/" by default to decide
# whether this instance is healthy enough to receive traffic -- without a
# real route here, that check got a 404, Render marked the whole service
# unhealthy, and refused to route ANY external request to it at all
# (regardless of the actual URL someone was trying to visit) -- which
# looked identical to every request 502ing, even though gunicorn and the
# app itself were completely fine underneath. This single route was the
# actual fix for that, not a code hang anywhere else.
@app.route('/', methods=['GET', 'HEAD'])
def root():
    return jsonify({"service": "soc-copilot-backend", "status": "running"}), 200


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

# Documents blueprint (Hermes report save / PDF export / email share).
# Guarded so the app still boots if the module isn't present yet -- without
# this registration the /api/documents/* routes don't exist at all, and the
# browser surfaces that as a CORS preflight failure rather than a 404,
# which is misleading to debug.
try:
    from hermes_documents import documents_bp
    app.register_blueprint(documents_bp, url_prefix="/api/documents")
    print("Documents blueprint registered — /api/documents/* available")
except ImportError as e:
    print(f"Documents blueprint not loaded: {e}")
# ─────────────────────────────────────────────────────────────────────────────

# Was DirectOllamaEmbeddings, pointed at a local Ollama server -- that
# meant retrieval could never work on any platform without Ollama running
# in-container, which is exactly the infrastructure problem this project
# spent a long time trying to solve (Docker + Ollama-for-embeddings-only
# on Render/HF Spaces/etc). GoogleGenerativeAIEmbeddings needs none of
# that: it's a REST API call, reuses the GEMINI_API_KEY already configured
# for ChatGoogleGenerativeAI, and langchain-google-genai is already a
# dependency. Zero new infrastructure.
#
# IMPORTANT: this is a different embedding space than nomic-embed-text --
# any existing ChromaDB collection built with the old embeddings is now
# stale and must be rebuilt (re-run rag_setup.py, or trigger a rebuild via
# /upload) before retrieval will return meaningful results again.
from langchain_google_genai import GoogleGenerativeAIEmbeddings

# Same lesson learned from Kokoro crashing the whole app at import time --
# GEMINI_API_KEY being missing/wrong should NOT take down every route,
# just the ones that need retrieval. Every retriever.invoke() call in this
# file already runs inside _call_with_timeout/_ping_with_timeout, which
# catch ANY exception -- including the AttributeError from calling
# .invoke() on retriever=None below -- and degrade gracefully (empty docs,
# "offline" health status) instead of propagating. So the only fix needed
# here is: don't let construction failure kill the process.
try:
    embeddings = GoogleGenerativeAIEmbeddings(model="gemini-embedding-001")
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
    """Returns DEFAULT_CLOUD_MODEL only if it's one of the three explicit
    cloud branches below -- otherwise falls back to "groq" instead. Without
    this, a typo/whitespace/wrong-case value in the DEFAULT_CLOUD_MODEL env
    var (e.g. "Mistral" instead of "mistral") would make get_llm()'s
    DEPLOYED fallback call itself with that same non-matching string over
    and over, forever -- a genuine infinite recursion this project hit in
    testing, not a hypothetical. Every path through this function is now
    guaranteed to land on a real terminal branch within one extra call."""
    value = (DEFAULT_CLOUD_MODEL or "").strip()
    return value if value in _KNOWN_CLOUD_MODELS else "groq"


def get_llm(model, api_key=None):
    # sira-model's own Modelfile bakes in temperature=0.4 for controlled,
    # grounded output -- every other model here was previously falling back
    # to its provider's own default (Ollama's default ~0.8, each cloud
    # provider's own default), which is meaningfully more random. Setting
    # the same tuned temperature explicitly everywhere -- rather than
    # creating and maintaining a separate Modelfile per model -- is the
    # simpler way to get consistent behaviour across every model choice.
    SIRA_TEMPERATURE = 0.4

    if model == "ollama_qwen":
        return OllamaLLM(model="qwen2.5:7b", temperature=SIRA_TEMPERATURE), "local"
    elif model == "ollama_phi3":
        return OllamaLLM(model="phi3:3.8b", temperature=SIRA_TEMPERATURE), "local"
    elif model == "ollama_phi4mini":
        # Phi-4-mini (3.8B, ~3GB) -- specifically documented as strong at
        # structured output and precise instruction-following despite its
        # small size, unlike a generic small model that trades that away.
        # Roughly half the footprint of qwen2.5:7b -- the lightweight
        # deployment-friendly option, not just a smaller/worse fallback.
        return OllamaLLM(model="phi4-mini", temperature=SIRA_TEMPERATURE), "local"
    elif model == "ollama_llama32":
        # Llama 3.2 3B (~2.5GB) -- smallest general-purpose option here,
        # solid everyday instruction-following for routine questions where
        # speed/footprint matters more than handling complex reasoning.
        return OllamaLLM(model="llama3.2:3b", temperature=SIRA_TEMPERATURE), "local"
    elif model == "groq":
        return ChatGroq(
            model="llama-3.3-70b-versatile",
            groq_api_key=api_key or os.getenv("GROQ_API_KEY"),
            temperature=SIRA_TEMPERATURE,
        ), "cloud"
    elif model == "gemini":
        return ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",
            google_api_key=api_key or os.getenv("GEMINI_API_KEY"),
            temperature=SIRA_TEMPERATURE,
        ), "cloud"
    elif model == "mistral":
        return ChatMistralAI(
            model="mistral-small-latest",
            # Was os.getenv(...) only -- silently ignored the "use your own
            # key" toggle on the frontend regardless of what the user
            # entered there. Groq and Gemini above already did this
            # correctly; Mistral just hadn't been updated to match.
            mistral_api_key=api_key or os.getenv("MISTRAL_API_KEY"),
            temperature=SIRA_TEMPERATURE,
        ), "cloud"
    elif model == "ollama":
        # This is the frontend's literal default selectedModel value.
        # Locally (DEPLOYED unset) this is sira-model, same as always. On
        # Render, there's no Ollama server to reach at all -- defaulting to
        # a cloud model here means a fresh visitor who never touched the
        # model dropdown still gets a working answer instead of a
        # connection-refused error.
        if DEPLOYED:
            return get_llm(_safe_cloud_default(), api_key)
        return OllamaLLM(model="sira-model", temperature=SIRA_TEMPERATURE), "local"
    else:
        # Any unrecognised model string -- same deployment-aware default as
        # the explicit "ollama" branch above, for the same reason.
        if DEPLOYED:
            return get_llm(_safe_cloud_default(), api_key)
        return OllamaLLM(model="sira-model", temperature=SIRA_TEMPERATURE), "local"


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


def _invoke_llm(model, prompt, api_key=None, allow_fallback=True):
    """Runs `prompt` through `model` and returns (answer, model_used,
    fell_back). Centralises the resilience behaviour so /ask,
    attacker-profile, what-if, and the compliance health check all get the
    same protection instead of each having to remember to implement it.

    If `model` resolves to a local Ollama model and the call fails with a
    connection error (i.e. no Ollama actually running here) while
    DEPLOYED=true, retries ONCE against DEFAULT_CLOUD_MODEL instead of
    hard-failing -- so a demo running locally with Ollama up behaves
    exactly as before (no fallback ever triggers, nothing changes), but the
    same code deployed on Render recovers automatically instead of
    breaking for anyone who ends up on a local-model code path. Any other
    failure (bad API key, genuine rate limit, real bug) is re-raised
    unchanged so callers keep their existing specific error handling.
    """
    llm, llm_type = get_llm(model, api_key)
    try:
        result = llm.invoke(prompt)
        answer = result if llm_type == "local" else result.content
        return answer, model, False
    except Exception as e:
        err_msg = str(e)
        if allow_fallback and llm_type == "local" and DEPLOYED and _is_connection_error(err_msg):
            fallback_llm, _ = get_llm(DEFAULT_CLOUD_MODEL, None)
            answer = fallback_llm.invoke(prompt).content
            return answer, DEFAULT_CLOUD_MODEL, True
        raise


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


# edge-tts needs no model files and no lazy-loading dance -- it's just an
# async HTTP call to Microsoft's Edge speech service. This one helper is
# used by both /sira-speak and /sira-face-speak's audio-generation step.
DEFAULT_VOICE = "en-GB-ThomasNeural"
# A calmer, more deliberate default delivery -- edge-tts's default rate
# reads slightly quick/casual for an assistant persona. Small, non-extreme
# adjustments in both directions: unlike a specific ElevenLabs voice
# clone, this doesn't change WHICH voice you're hearing, only its pacing
# and register -- the actual transferable lever available here.
DEFAULT_RATE = "-8%"
DEFAULT_PITCH = "-3Hz"

# Only voices actually confirmed working (tested via `edge-tts --write-media`)
# go in this list -- a guessed name that doesn't exist raises
# edge_tts.exceptions.NoAudioReceived, learned the hard way. Expand this
# once you've run `edge-tts --list-voices` and confirmed more names.
KNOWN_VOICES = [
    {"id": "en-GB-ThomasNeural", "label": "Thomas (British, calm)", "default": True},
    {"id": "en-GB-RyanNeural",   "label": "Ryan (British, precise)", "default": False},
]


async def _synthesize_speech(text, voice=None, rate=None, pitch=None):
    """Returns raw MP3 bytes. rate/pitch accept edge-tts's format, e.g.
    "-8%" and "-3Hz" -- defaults tuned for a calmer, more deliberate
    delivery than edge-tts's out-of-the-box pacing."""
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
    """Sync wrapper -- Flask routes are sync, edge-tts's API is async."""
    return asyncio.run(_synthesize_speech(text, voice=voice, rate=rate, pitch=pitch))


@app.route("/voices", methods=["GET"])
def get_voices():
    return jsonify(KNOWN_VOICES)


@app.route("/sira-speak", methods=["POST"])
def sira_speak():
    text = request.json.get("text", "")
    voice = request.json.get("voice") or DEFAULT_VOICE
    rate = request.json.get("rate")   # None -> get_speech_audio falls back to DEFAULT_RATE
    pitch = request.json.get("pitch") # None -> falls back to DEFAULT_PITCH
    if not text:
        return jsonify({"error": "no text"}), 400
    try:
        audio_bytes = get_speech_audio(text[:500], voice=voice, rate=rate, pitch=pitch)
        return Response(audio_bytes, mimetype="audio/mpeg")
    except Exception as e:
        return jsonify({"error": str(e)}), 500



# ── SIRA FACE: edge-tts -> Wav2Lip -> synced video ────────────────────────
import subprocess
import uuid

WAV2LIP_DIR = os.path.join(os.path.dirname(__file__), 'Wav2Lip')
WAV2LIP_PYTHON = os.path.join(WAV2LIP_DIR, 'venv', 'Scripts', 'python.exe')
WAV2LIP_CHECKPOINT = os.path.join('checkpoints', 'wav2lip_gan.pth')  # relative -- cwd is WAV2LIP_DIR
WAV2LIP_FACE = os.path.join(WAV2LIP_DIR, 'sira_face.jpg')


@app.route('/sira-face-speak', methods=['POST'])
def sira_face_speak():
    """
    Text -> edge-tts -> Wav2Lip (runs in its own Python 3.10 venv, separate
    from Flask's interpreter) -> synced video, returned directly.

    NOTE: Wav2Lip itself remains out of scope for deployment (Windows-only
    venv path, heavy compute, large checkpoint file) -- this fix only
    replaces the audio-generation step so this route fails cleanly with
    its existing error handling below instead of crashing on a missing
    get_kokoro_model(). Making Wav2Lip itself work on a deploy target is a
    separate, bigger task.
    """
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
                "--pads", "0", "20", "0", "0",  # extra bottom padding -- reduces the mouth-region seam
                "--nosmooth",                    # disable over-smoothing that can cause blur/ghosting
                "--resize_factor", "4",          # downscale processing further (was 2) -- genuine speed win, real quality tradeoff. If this looks too blurry, drop back to 2 or 3.
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

def _extract_spoken_summary(text):
    """Splits SPOKEN_SUMMARY: (always the last line, per the prompt) out of
    the model's response. Returns (report_text_without_it, spoken_summary).
    If the model didn't include one -- smaller/simpler models sometimes
    drop instructions near the end of a long prompt -- spoken_summary is
    "" and the caller falls back to the old trimmed-report behaviour."""
    if not text:
        return text, ""
    marker = "SPOKEN_SUMMARY:"
    idx = text.rfind(marker)
    if idx == -1:
        return text, ""
    report = text[:idx].rstrip()
    spoken = text[idx + len(marker):].strip()
    return report, spoken


def _rewrite_followup_question(question, history):
    """Turns a vague follow-up ("what is this IP", "the second one", "compare
    that to the one before") into ONE fully self-contained question, using
    recent conversation context to fill in whatever it's actually referring
    to. This is what lets retrieval handle ordinal references ("the second
    one") and multi-hop follow-ups that keyword matching or single-turn
    semantic search can't resolve on their own -- those need something to
    actually reason about what the reference points to first.

    Uses phi4-mini specifically: this is a small, bounded rewriting task,
    not the full grounded-QA problem -- a fast, light model is a good fit
    here even though a bigger model is used for the real answer.
    Fails safe: any error, or an empty result, just returns the original
    question unchanged rather than blocking the request.
    """
    if not history:
        return question  # nothing to resolve a reference against -- skip the extra call entirely
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


@app.route('/ask', methods=['POST'])
def ask():
    data        = request.json
    question    = data.get('question', '')
    model       = data.get('model', 'ollama')
    api_key     = data.get('api_key', None)
    date_filter = data.get('date', None)
    hour_filter = data.get('hour', None)
    history     = data.get('history', [])
    honorific   = (data.get('honorific') or 'Sir').strip()

    # Identity/meta questions ("who are you", "what can you do") aren't
    # about log data at all -- retrieving logs for them just grabs whatever
    # random entries are nearest in the vector index, and the log-analysis
    # prompt below then forces the model to write a fake incident report
    # about them. Answer these directly instead, with no retrieval.
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
        if fell_back:
            resp['fallback_used'] = True
            resp['fallback_note'] = f"{model} wasn't reachable here, answered with {used_model} instead"
        return jsonify(resp)

    # Retrieval normally only searches the CURRENT question's text -- but a
    # vague follow-up ("what is this IP", "tell me more about that") gives
    # the search almost nothing concrete to match against, even though the
    # user is clearly referring to something from the PREVIOUS answer. This
    # is why a real IP mentioned in a summary a moment ago can come back
    # "not found in logs" on the very next question -- retrieval genuinely
    # found nothing, not because the data isn't there.
    last_ai_text = ""
    for m in reversed(history):
        if m.get('role') in ('assistant', 'ai') and m.get('content'):
            last_ai_text = m['content']
            break

    # Resolve vague references ("this IP", "the second one") into a real,
    # self-contained question BEFORE retrieval -- everything downstream
    # (semantic search, the IP regex boost, the final prompt) uses this
    # resolved version instead of the raw, possibly-ambiguous original.
    resolved_question = _rewrite_followup_question(question, history)

    def _do_retrieval():
        docs = retriever.invoke(resolved_question)
        if last_ai_text:
            # Supplement with a query that includes what was just discussed,
            # so vague follow-ups can still land on the right log entries.
            followup_docs = retriever.invoke(f"{last_ai_text[:400]} {resolved_question}")
            docs = followup_docs + docs

        if date_filter:
            docs = [d for d in docs if d.metadata.get('date') == date_filter]
        if hour_filter:
            docs = [d for d in docs if d.metadata.get('hour') == hour_filter]
        if not docs:
            docs = retriever.invoke(question)

        # Boost alert docs to top — always prioritise real alerts over flow/dns
        alert_docs = [d for d in docs if d.metadata.get('event_type') == 'alert']
        other_docs = [d for d in docs if d.metadata.get('event_type') != 'alert']
        docs = alert_docs + other_docs

        # If question contains an IP, fetch extra targeted logs for that IP. If the
        # CURRENT question doesn't name one explicitly -- e.g. "what is this IP",
        # referring back to something already discussed -- fall back to any IP
        # mentioned in the most recent AI response, instead of finding nothing.
        ip_match = re.findall(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', resolved_question)
        if not ip_match and last_ai_text:
            ip_match = re.findall(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', last_ai_text)
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
        return unique_docs[:15]

    # Bounded at 15s total for the whole retrieval sequence (up to 4
    # retriever.invoke() calls chained together above) -- without this, an
    # unreachable embeddings backend (e.g. DEPLOYED=true with no Ollama for
    # nomic-embed-text) would hang here the same way /health used to hang,
    # taking the single gunicorn worker down with it. On timeout/failure,
    # docs degrades to [] -- the prompt below already instructs the model to
    # say plainly when it has no relevant log data, so an empty context
    # produces an honest "not available" answer instead of a crash.
    docs = _call_with_timeout(_do_retrieval, 15, default=[])

    context = "\n\n".join([d.page_content for d in docs])
    context = re.sub(
    r'\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):\d{2}[.\d]*\+\d{4}',
    lambda m: f"at {m.group(1)}:{m.group(2)}",
    context
)

    # The smallest models (phi4-mini, llama3.2:3b) tend to lose track of the
    # grounding constraint somewhere inside a long, multi-branch instruction
    # set -- every model gets the SAME retrieved log data, so a smaller
    # model giving worse/invented answers than sira-model on identical
    # context is a real instruction-following capacity issue, not a data
    # problem. A short, single-purpose prompt (nothing to lose track of)
    # measurably helps smaller models stay grounded, at the cost of the
    # richer structured-report formatting the larger models can reliably
    # follow.
    SIMPLE_PROMPT_MODELS = {"ollama_phi4mini", "ollama_llama32"}

    if model in SIMPLE_PROMPT_MODELS:
        prompt = f"""You are SIRA, a security assistant. Answer the question below using ONLY the log data provided. Do not invent any IP address, CVE, signature, or event that is not shown here. Private/internal IP addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x) and known cloud platform IPs (168.63.129.16, 169.254.169.254) are internal infrastructure, not attackers -- never describe them as an attack. If the log data below does not answer the question, say so plainly.

Log Data:
{context}

Question: {resolved_question}

Remember: only use facts from the log data above. Answer clearly and concisely.

After your answer, add one final line starting with SPOKEN_SUMMARY: followed by 1-2 short sentences that say the same thing as if you were talking to {honorific} out loud -- plain conversational language, no bullet points, no technical formatting, don't just re-read the answer above. Address {honorific} naturally once."""
    else:
        prompt = f"""You are SIRA — Security Incident Response Assistant.
Speak exactly like JARVIS from Iron Man. Calm, authoritative, precise.
Address the analyst as "{honorific}" occasionally.
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

    # Split the model's own natural spoken summary out of the written
    # report -- the frontend uses this for voice instead of trimming down
    # the structured report text, which always sounded like a report being
    # read aloud no matter how it was cleaned up.
    answer, spoken_summary = _extract_spoken_summary(answer)

    resp = {'answer': answer, 'model_used': used_model, 'spoken_summary': spoken_summary}
    if fell_back:
        resp['fallback_used'] = True
        resp['fallback_note'] = f"{model} wasn't reachable here, answered with {used_model} instead"
    return jsonify(resp)


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


import concurrent.futures


def _ping_with_timeout(fn, timeout_seconds=5):
    """Runs fn() with a hard wall-clock timeout, so a slow or hanging
    provider call (an unreachable local Ollama, a slow cloud API) can never
    block a request indefinitely. This matters a lot on Render's free tier
    specifically -- WEB_CONCURRENCY=1 means a single gunicorn worker, so one
    stuck request blocks every other request too, which is what was causing
    /health itself to 502: the ping never actually errored, it just never
    returned, so nothing else could be served either.

    Deliberately NOT using `with ThreadPoolExecutor(...) as executor:` here.
    That context manager calls shutdown(wait=True) on exit -- including
    when exiting via a caught TimeoutError -- which blocks until the
    background task actually finishes regardless of the timeout already
    having been handled. That silently defeated the whole point of this
    function: it would catch the timeout, then immediately re-block on
    cleanup waiting for the same hung call. shutdown(wait=False) below is
    what actually lets this function return promptly.
    """
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
    """Same bounded-execution idea as _ping_with_timeout, but returns fn()'s
    actual return value (or `default` on timeout/error) instead of a bool.
    Used for retrieval calls, where a caller needs the docs list itself --
    not just whether the call succeeded -- and where the right behaviour on
    failure is graceful degradation (answer with no log context, note that
    plainly) rather than treating it as a hard error."""
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
    if DEPLOYED:
        # No point pinging local Ollama when we already know there's no
        # Ollama server on this box -- skip it rather than risk any delay,
        # however small, on the one worker Render's free tier gives us.
        ollama_status = "skipped (DEPLOYED=true)"
    else:
        ok, err = _ping_with_timeout(lambda: OllamaLLM(model="sira-model").invoke("ping"), 5)
        ollama_status = "ok" if ok else f"offline — {err}"

    cloud_status = "not checked"
    if DEPLOYED:
        ok, err = _ping_with_timeout(lambda: get_llm(DEFAULT_CLOUD_MODEL)[0].invoke("ping"), 8)
        cloud_status = "ok" if ok else f"offline — {err}"

    ok, err = _ping_with_timeout(lambda: vectorstore.get(limit=1), 5)
    chroma_status = "ok" if ok else f"offline — {err}"

    # A working LLM path is either local Ollama OR (when deployed) a
    # reachable cloud model -- local being down is expected and fine on a
    # deployed instance with no Ollama server, as long as cloud works.
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
    honorific = (request.args.get('honorific') or 'Sir').strip()

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
    docs = _call_with_timeout(lambda: retriever.invoke(f"attacks from {ip}"), 15, default=[])
    context = "\n\n".join([d.page_content for d in docs[:8]])
    prompt = f"""You are SIRA — speak like JARVIS from Iron Man. Calm, authoritative, precise. Address the analyst as {honorific} occasionally. Based on the log data, create a threat actor profile for IP {ip}.
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
        sira_assessment, _, _ = _invoke_llm("ollama", prompt)
    except Exception:
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
        err_msg = str(e)
        # Same idea as _invoke_llm's fallback, applied here by hand since
        # run_hermes_agent has its own internal model handling rather than
        # going through get_llm(). NOTE: this assumes run_hermes_agent
        # accepts DEFAULT_CLOUD_MODEL's id ("groq" by default) the same way
        # /ask's models do -- if ai/hermes_agent.py resolves model names
        # differently internally, this retry will just fail too and you'll
        # see the ORIGINAL error below (never masked), which is the signal
        # to share that file so this can be wired in properly.
        if DEPLOYED and _is_connection_error(err_msg):
            try:
                from ai.hermes_agent import run_hermes_agent as _retry
                result = _retry(task, model=DEFAULT_CLOUD_MODEL)
                result["fallback_used"] = True
                result["fallback_note"] = f"{model} wasn't reachable here, ran with {DEFAULT_CLOUD_MODEL} instead"
                return jsonify(result)
            except Exception:
                pass  # fall through to the original error below

        # Print the full traceback to the Flask console -- without this, a
        # failure here surfaces to the browser as a bare 500 with no way to
        # tell whether it was an import error, a missing Ollama model, or a
        # tool failure inside the agent.
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


# ── APPROVAL-GATED ACTIONS ────────────────────────────────────────────────
# Hermes (or SIRA) PROPOSES an action here -- it never executes anything
# directly itself. A human must explicitly approve before anything real
# happens. This is a deliberate design choice, not a missing feature:
# autonomous firewall/service actions carry real risk (a false positive
# blocking legitimate traffic, a bad service restart), so every action
# waits for a person to click approve first.

def init_actions_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS pending_actions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            action_type TEXT NOT NULL,   -- block_ip | isolate_endpoint | restart_service | add_suricata_rule
            target      TEXT NOT NULL,   -- IP / machine_id / service name / rule text
            machine_id  TEXT,            -- which endpoint this applies to, NULL for honeypot-side actions
            reason      TEXT,            -- why this was proposed -- real evidence, not a guess
            status      TEXT DEFAULT 'pending',  -- pending | approved | rejected | executed | failed
            created_at  TEXT,
            executed_at TEXT,
            result      TEXT
        )
    ''')
    conn.commit()
    conn.close()

init_actions_db()


def _execute_add_suricata_rule(rule_text):
    """SSH to the honeypot and append a new custom Suricata rule, then
    reload Suricata via SIGHUP -- same connection details as
    honeypot_log_sync.py, and the same SIGHUP-not-SIGUSR2 lesson learned
    earlier (SIGUSR2 only reloads rules, it does NOT reopen log files --
    but here we specifically WANT the rule-reload behaviour SIGHUP also
    provides, so either signal works for this specific action; SIGHUP is
    used for consistency with the rest of the project).

    IMPORTANT SETUP NOTE: this appends to /etc/suricata/rules/custom.rules
    on the honeypot. That file must actually be listed in suricata.yaml's
    rule-files section for Suricata to load it -- if alerts from a newly
    added rule never show up, check that first before assuming this
    function is broken.
    """
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


@app.route('/propose-action', methods=['POST'])
def propose_action():
    """Hermes (or SIRA) calls this to propose an action -- it only ever
    creates a pending row. Nothing executes until a human approves it via
    /pending-actions/<id>/approve."""
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
        # Reuses the existing Sentinel block-queue mechanism -- delivered
        # to any polling endpoint agent's next /ingest check-in.
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
        # Marked approved and queryable, but NOT yet actually executable --
        # that needs new command handling inside sentinel_launcher.py
        # (the endpoint agent) which isn't wired up yet. Kept as a real,
        # visible "approved but not yet executable" state rather than
        # silently pretending it worked.
        conn.execute("UPDATE pending_actions SET status='approved', executed_at=?, result=? WHERE id=?",
                     (now, "Approved -- execution for this action type is not yet implemented on the endpoint agent", action_id))
        conn.commit()
        conn.close()
        return jsonify({"status": "approved", "detail": "Approved, but endpoint-agent execution isn't wired up yet for this action type"})

    conn.close()
    return jsonify({"error": "unknown action_type"}), 400


@app.route('/pending-actions/<int:action_id>/reject', methods=['POST'])
def reject_pending_action(action_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM pending_actions WHERE id = ?", (action_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not found"}), 404
    conn.execute("UPDATE pending_actions SET status='rejected' WHERE id=?", (action_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "rejected"})



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

    if DEPLOYED:
        ollama_ok = False
    else:
        ollama_ok, _ = _ping_with_timeout(lambda: OllamaLLM(model="sira-model").invoke("ping"), 5)
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


_honeypot_sync_started = False


def _maybe_start_honeypot_sync():
    """Starts the honeypot sync thread exactly once, however this process
    was launched. Two different launch paths need two different guards:

    - Gunicorn (Render's typical production launch) IMPORTS this module --
      it never runs the `if __name__ == '__main__':` block below at all, so
      the sync thread must start here, at true module level, guarded only
      by "has this process already started it" (no Werkzeug reloader is
      involved in this path, so there's no double-start risk to guard
      against).
    - `python app.py` locally uses Flask's debug reloader, which re-execs
      this entire file in a child process with WERKZEUG_RUN_MAIN=true --
      starting unconditionally at module level would run this in BOTH the
      parent watcher process and the child, which is the exact double-sync
      bug already documented below. That path keeps its own explicit
      WERKZEUG_RUN_MAIN check inside __main__.
    """
    global _honeypot_sync_started
    if _honeypot_sync_started:
        return
    _honeypot_sync_started = True
    from ai.honeypot_log_sync import start_background_sync
    start_background_sync()


if __name__ != '__main__':
    # Being imported, not run as a script -- this is the gunicorn/production
    # path. Start immediately; see docstring above for why this is safe.
    _maybe_start_honeypot_sync()


if __name__ == '__main__':
    # Pull Suricata/Zeek logs from the public honeypot VM automatically,
    # instead of manually uploading eve.json/conn.log. WERKZEUG_RUN_MAIN is
    # only set in the child process the debug reloader actually forks to
    # serve requests -- checking it here (rather than starting unconditionally)
    # stops the sync thread from being started twice (once in the reloader's
    # parent watcher process, once in the child) when debug=True.
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        _maybe_start_honeypot_sync()

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