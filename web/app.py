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
from werkzeug.utils import secure_filename
import csv 
import io
from flask import Response
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

app = Flask(__name__)
CORS(app)

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

# Boost alert docs to top — always prioritise real alerts over flow/dns
    alert_docs = [d for d in docs if d.metadata.get('event_type') == 'alert']
    other_docs  = [d for d in docs if d.metadata.get('event_type') != 'alert']
    docs = alert_docs + other_docs

# If question contains an IP, fetch extra targeted logs for that IP
    import re
    ip_match = re.findall(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', question)
    if ip_match:
        for ip in ip_match:
            ip_docs = retriever.invoke(f"src_ip {ip} alert")
            alert_ip_docs = [d for d in ip_docs if
                             d.metadata.get('src_ip') == ip or
                             d.metadata.get('dest_ip') == ip]
        docs = alert_ip_docs + docs

# Deduplicate while preserving order
    seen = set()
    unique_docs = []
    for d in docs:
        if d.page_content not in seen:
           seen.add(d.page_content)
           unique_docs.append(d)
    docs = unique_docs[:15]

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
    if filename not in ['eve.json', 'conn.log']:
        return jsonify({"error": "Invalid file name. Only eve.json and conn.log are accepted."}), 400

    save_path = os.path.join(os.path.dirname(__file__), '..', 'logs', filename)

    backup_path = save_path + '.bak'
    if os.path.exists(save_path):
        shutil.copy(save_path, backup_path)

    file.save(save_path)

    try:
        rag_script = os.path.join(os.path.dirname(__file__), '..', 'ai', 'rag_setup.py')
        subprocess.run(['python', rag_script], timeout=120, check=True)
        return jsonify({"message": f"{filename} uploaded and ChromaDB rebuilt successfully"})
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


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=5000)