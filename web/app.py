from flask import Flask, request, jsonify
from flask_cors import CORS
from langchain_ollama import OllamaLLM
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_ollama import OllamaEmbeddings
from langchain_chroma import Chroma
from  langchain_mistralai import ChatMistralAI
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

@app.route('/ask', methods=['POST'])
def ask():
    data = request.json
    question = data.get('question', '')
    model = data.get('model', 'ollama')
    api_key = data.get('api_key', None)
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

    prompt = f"""You are SIRA, an expert cybersecurity analyst.
Use ONLY the log data below to answer the question.
Be specific with IPs, timestamps and signatures.
Structure your answer with SUMMARY, THREAT DETAILS, RISK ASSESSMENT and RECOMMENDED ACTIONS.

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
    logs = []
    with open('../logs/eve.json', 'r') as f:
        for line in f:
            try:
                log = json.loads(line)
                if log.get('event_type') in ['alert', 'dns', 'http', 'flow', 'tls']:
                    logs.append(log)
            except:
                pass
    return jsonify(logs[:50])

@app.route('/models', methods=['GET'])
def get_models():
    return jsonify([
        {"id": "ollama", "name": "SIRA Model — qwen2.5 (local)", "requires_key": False},
        {"id": "ollama_phi3", "name": "Phi3 3.8B (local — fastest)", "requires_key": False},
        {"id": "groq", "name": "Groq — Llama 3.3 70B (cloud)", "requires_key": False},
        {"id": "gemini", "name": "Google Gemini 2.0 Flash (cloud - free)", "requires_key": False},
        {"id": "mistral", "name": "Mistral Small (cloud — free)", "requires_key": False}    
    ])

if __name__ == '__main__':
    app.run(debug=True, port=5000)