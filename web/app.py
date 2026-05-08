from flask import Flask, request, jsonify
from flask_cors import CORS
from langchain_ollama import OllamaLLM
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_ollama import OllamaEmbeddings
from langchain_chroma import Chroma
from langchain_mistralai import ChatMistralAI
from collections import Counter
import json
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

app = Flask(__name__)
CORS(app)

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
    """Helper to load and filter logs from eve.json."""
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


@app.route('/ask', methods=['POST'])
def ask():

    data = request.json
    question  = data.get('question', '')
    model     = data.get('model', 'ollama')
    api_key   = data.get('api_key', None)
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

    prompt = f"""
You are SIRA, an expert cybersecurity analyst.

Use ONLY the log data below to answer the question.
Be specific with IPs, timestamps and signatures.

Structure your answer with:
SUMMARY
THREAT DETAILS
RISK ASSESSMENT
RECOMMENDED ACTIONS

Log Data:
{context}

Question:
{question}

Answer:
"""

    if llm_type == "local":
        answer = llm.invoke(prompt)
    else:
        answer = llm.invoke(prompt).content

    return jsonify({
        'answer': answer,
        'model_used': model
    })


@app.route('/logs', methods=['GET'])
def get_logs():
    logs = load_logs()
    return jsonify(logs[:50])


@app.route('/models', methods=['GET'])
def get_models():
    return jsonify([
        {"id": "ollama",      "name": "SIRA Model — qwen2.5 (local)",       "requires_key": False},
        {"id": "ollama_phi3", "name": "Phi3 3.8B (local — fastest)",         "requires_key": False},
        {"id": "groq",        "name": "Groq — Llama 3.3 70B (cloud)",        "requires_key": False},
        {"id": "gemini",      "name": "Google Gemini 2.0 Flash (cloud-free)", "requires_key": False},
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
            "ip":       ip,
            "score":    data.get("abuseConfidenceScore", 0),
            "country":  data.get("countryCode", "??"),
            "reports":  data.get("totalReports", 0),
            "malicious": data.get("abuseConfidenceScore", 0) > 25
        })
    except:
        return jsonify({"ip": ip, "score": 0, "malicious": False, "error": "lookup failed"})


# ── /stats ──────────────────────────────────────────────────────────────────
@app.route('/stats', methods=['GET'])
def stats():
    """
    Returns:
      total_events   — all filtered log lines
      alert_count    — lines where event_type == alert
      unique_ips     — distinct src_ip values
      top_source_ips — top 3 src_ips by frequency
      event_breakdown — count per event_type
    """
    logs = load_logs()

    total_events = len(logs)

    alert_count = sum(1 for l in logs if l.get('event_type') == 'alert')

    unique_ips = len(set(l.get('src_ip') for l in logs if l.get('src_ip')))

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
        "top_source_ips":  top_source_ips,   # [["192.168.x.x", 12], ...]
        "event_breakdown": event_breakdown,   # {"alert":2,"dns":8, ...}
    })


# ── /health 
@app.route('/health', methods=['GET'])
def health():
    """
    Actually tests each component instead of returning hardcoded 'ok'.
    - flask:    always ok (if this runs, Flask is up)
    - ollama:   tries a tiny LLM invoke
    - chromadb: tries a vectorstore peek
    """

    # Flask — ok
    flask_status = "ok"

    # Ollama — real ping
    try:
        OllamaLLM(model="sira-model").invoke("ping")
        ollama_status = "ok"
    except Exception as e:
        ollama_status = f"offline — {str(e)[:60]}"

    # ChromaDB — real peek
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
    app.run(debug=True, port=5000)