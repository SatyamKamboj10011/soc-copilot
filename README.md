# SOC Investigation Copilot

An AI-powered Security Operations Center (SOC) tool built with React and Flask.
It helps security analysts investigate real network attack logs, detect threats, and respond to incidents faster — using multiple AI models and a RAG (Retrieval-Augmented Generation) pipeline over real Suricata and Zeek data.

---

## What it does

### 🤖 SIRA — AI Security Assistant
- Ask questions about your logs in plain English
- SIRA answers with structured responses — **SUMMARY**, **THREAT DETAILS**, **WHAT THIS MEANS**, **RISK ASSESSMENT**, **RECOMMENDED ACTIONS**
- Explains threats clearly for both experts and beginners
- Powered by RAG — answers come from your actual logs, not general knowledge
- Switch between 5 AI models in real time

### 📊 Dashboard
- Live feed of network events from Suricata and Zeek logs
- Filter events by type — Alert, DNS, HTTP, TLS, Flow
- IP reputation badges powered by AbuseIPDB — red warning or green clean on every alert IP
- Real stats from Flask — total events, alert count, unique IPs
- Auto-refreshes every 30 seconds
- Status pills show real health of Suricata, Zeek, Ollama and ChromaDB

### 📈 Analytics Page
- Bar chart — events per hour
- Event type breakdown — alert / dns / http / tls / flow
- Top 10 attacker IPs ranked by frequency

### 🔍 Investigation Page
- Search logs by IP address or alert signature
- Full log table with type badges, timestamps and IPs
- Click any event to open full details — alert name, category, severity, protocol, ports
- Ask SIRA button on every event — pre-fills the chat and switches to Dashboard

### 🔌 REST API Endpoints
| Endpoint | Description |
|---|---|
| `POST /ask` | Ask SIRA a question — returns AI analysis |
| `GET /logs` | Live feed of recent events |
| `GET /stats` | Total events, alert count, unique IPs, event breakdown |
| `GET /health` | Real health check — Flask, Ollama, ChromaDB |
| `GET /search?q=` | Search logs by IP or alert signature |
| `GET /timeline` | Events grouped by hour |
| `GET /top-ips` | Top attacker IPs by frequency |
| `GET /zeek-logs` | Zeek conn.log events |
| `GET /correlate/ip?ip=` | Correlate Suricata + Zeek events by IP |
| `GET /export` | Download all alerts as CSV |
| `POST /upload` | Upload new eve.json or conn.log and rebuild ChromaDB |
| `GET /reputation/<ip>` | Live AbuseIPDB IP reputation lookup |

---

## AI Models

| Model | Type | Notes |
|---|---|---|
| SIRA (qwen2.5:7b) | Local — Ollama | Custom trained on cybersecurity logs |
| Phi3 3.8B | Local — Ollama | Fastest local option |
| Groq Llama 3.3 70B | Cloud — Free | Best quality answers |
| Google Gemini 2.0 Flash | Cloud — Free | Fast cloud option |
| Mistral Small | Cloud — Free | Alternative cloud model |

All API keys managed securely in backend `.env` — no key prompt in the UI.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, Space Mono + Syne fonts |
| Backend | Flask, Python 3.14 |
| AI / RAG | LangChain, ChromaDB, nomic-embed-text |
| Local LLMs | Ollama (qwen2.5:7b, phi3:3.8b) |
| Cloud LLMs | Groq, Google Gemini, Mistral |
| Log Sources | Suricata (eve.json), Zeek (conn.log) |
| Threat Intel | AbuseIPDB API |
| Attack Lab | Kali Linux → Metasploitable 2 |

---

## How to run

### Prerequisites
- Python 3.14
- Node.js
- Ollama running locally with `sira-model` and `nomic-embed-text`
- API keys in `.env` file (root of project)

### Quick start
Double-click `start.bat` — starts Flask, builds ChromaDB and launches React.

### Manual start

**Step 1 — Build ChromaDB**
```bash
cd ai
python rag_setup.py
```

**Step 2 — Start Flask backend**
```bash
cd web
python app.py
```
Flask runs at `http://localhost:5000`

**Step 3 — Start React frontend**
```bash
cd web-react
npm install
npm start
```
Open browser at `http://localhost:3000`

---

## Project Structure

```
soc-copilot/
├── ai/
│   ├── rag_setup.py          # Builds ChromaDB from Suricata + Zeek logs
│   ├── train_test_split.py   # Splits logs 80/20 for evaluation
│   ├── evaluate.py           # Tests SIRA on unseen logs
│   └── chroma_db/            # Vector store
├── web/
│   └── app.py                # Flask REST API
├── web-react/
│   └── src/App.js            # React dashboard
├── logs/
│   ├── eve.json              # Suricata attack events (22,000+)
│   ├── conn.log              # Zeek connection logs
│   ├── train_logs.json       # 80% training split
│   └── test_logs.json        # 20% test split
├── Modelfile                 # Custom SIRA model definition
├── .env                      # API keys (not committed)
└── start.bat                 # One-click start script
```

---

## Environment Variables

Create a `.env` file in the project root:

```
GROQ_API_KEY=your_groq_key
GEMINI_API_KEY=your_gemini_key
MISTRAL_API_KEY=your_mistral_key
ABUSEIPDB_API_KEY=your_abuseipdb_key
```

---

## Attack Lab Setup

Real attack data generated using:
- **Attacker** — Kali Linux `192.168.56.103`
- **Target** — Metasploitable 2 `192.168.56.102`
- **IDS** — Suricata capturing eve.json + Zeek capturing conn.log
- Attacks include IRC C2, NTLMv1 auth, port scans, HTTP exploits

---

## Team

| Name | Role |
|---|---|
| Satyam Kamboj | Backend — Flask API, RAG pipeline, AI retrieval, new endpoints |
| Pratham | Frontend — React UI, authentication, analytics, investigation pages |

**Supervisor:** Senaka & Barry 
**Institution:** Otago Polytechnic Auckland International Campus — Studio 5 Block 2 2026
