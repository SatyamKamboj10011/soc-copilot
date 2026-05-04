from flask import Flask, request, jsonify
from flask_cors import CORS
from langchain_groq import ChatGroq
from langchain_ollama import OllamaEmbeddings
from langchain_chroma import Chroma
import json
import os
from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)
CORS(app)

embeddings = OllamaEmbeddings(model="nomic-embed-text")
vectorstore = Chroma(
    persist_directory="../ai/chroma_db",
    embedding_function=embeddings
)

llm = ChatGroq(
    model="llama-3.3-70b-versatile",
   groq_api_key=os.getenv("GROQ_API_KEY"),
    temperature=0.1,
    max_tokens=1024
)

retriever = vectorstore.as_retriever(search_kwargs={"k": 8})

@app.route('/ask', methods=['POST'])
def ask():
    question = request.json.get('question', '')
    docs = retriever.invoke(question)
    context = "\n\n".join([d.page_content for d in docs])

    prompt = f"""You are SIRA (Security Incident Response Assistant), an expert cybersecurity analyst in a Security Operations Centre.

STRICT RULES:
- Only use information from the log data provided below
- Never make up or guess information
- Always be specific with exact IPs, ports, timestamps, and signatures
- Keep answers concise and professional

ANSWER FORMAT — Always use this exact structure:

🔍 SUMMARY
One sentence direct answer.

⚠️ THREAT DETAILS
- Alert/Event: [exact signature name]
- Source IP: [exact IP]
- Destination IP: [exact IP]  
- Time: [exact timestamp]
- Protocol: [TCP/UDP/etc]
- Severity: [1-3]

📊 RISK ASSESSMENT
- Risk Level: [CRITICAL / HIGH / MEDIUM / LOW]
- Why: [one sentence explanation]

✅ RECOMMENDED ACTIONS
1. [First action]
2. [Second action]
3. [Third action]

Log Data:
{context}

Question: {question}

Answer:"""

    response = llm.invoke(prompt)
    return jsonify({'answer': response.content})

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

if __name__ == '__main__':
    app.run(debug=True, port=5000)