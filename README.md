# SOC Copilot

An AI-powered Security Operations Center (SOC) tool built with React and Flask.
It helps security analysts investigate network logs, detect threats, and respond to incidents faster.

## What it does

- Shows live network events from Suricata and Zeek logs
- ARIA — an AI assistant that answers questions about your logs
- Filter events by type (Alert, DNS, HTTP, Flow, TLS)
- Shows threat level (High, Medium, Low) based on alert count
- Incident Report Generator — download a .txt report for any selected alert
- Details, Logs, and MITRE ATT&CK tabs for deep investigation
- Escalate, Block IP, and Mark Investigated actions

## Tech Stack

- React (frontend)
- Flask (backend)
- Groq AI (LLM)
- Suricata + Zeek (log sources)

## How to run

**Frontend**
```bash
cd web-react
npm install
npm start
```


Open browser at `http://localhost:3000`

## Team

- Satyam Kamboj
- Pratham
