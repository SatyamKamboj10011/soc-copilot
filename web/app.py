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
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

app = Flask(__name__)
CORS(app)

# JWT Config
app.config["JWT_SECRET_KEY"] = "soc-copilot-secret-key-2024"
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

retriever = vectorstore.as_retriever(search_kwargs={"k": 5})


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

    llm, llm_type = get_llm(model, api_key)

    docs = retriever.invoke(question)

    if date_filter:
        docs = [d for d in docs if d.metadata.get('date') == date_filter]
    if hour_filter:
        docs = [d for d in docs if d.metadata.get('hour') == hour_filter]
    if not docs:
        docs = retriever.invoke(question)

    context = "\n\n".join([d.page_content for d in docs])

    prompt = f"""You are SIRA, Security Incident Response Assistant.
You analyze real network security logs and explain them clearly.
Your answers must be understood by BOTH security experts AND complete beginners.

Rules:
- Only use the log data provided below
- Always include specific IPs, timestamps, ports and alert names from the logs
- Never make up information not in the logs
- If data is not available, say so clearly
- Avoid heavy jargon — explain technical terms in plain English when you use them

Always structure your answer EXACTLY like this:

SUMMARY:
Write 2-3 plain English sentences explaining what happened, as if explaining to someone with no security background.

THREAT DETAILS:
- Alert: exact signature name from the logs
- Attacker IP: exact source IP
- Target IP: exact destination IP
- Time: exact timestamp
- Protocol: TCP / UDP / etc
- Severity: 1 (low), 2 (medium), or 3 (high)

WHAT THIS MEANS:
Explain in 2-3 simple sentences what this threat actually is and why it is dangerous.
No jargon. Imagine explaining to a friend who has never studied cybersecurity.

RISK ASSESSMENT:
- Risk Level: CRITICAL or HIGH or MEDIUM or LOW
- Why: one plain English sentence explaining the risk level

RECOMMENDED ACTIONS:
1. First action — explain why in plain English
2. Second action — explain why in plain English
3. Third action — explain why in plain English

Log Data:
{context}

Question: {question}

Answer:"""

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


if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=5000)