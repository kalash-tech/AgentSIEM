# AgentSIEM (Open Source)

**Flight Recorder, OpenSearch Security Guard, and Google Gemini Forensic Detective for AI Agents.**

AgentSIEM protects autonomous AI agents (like `HR-Bot`) from indirect prompt injection, unauthorized file access, and data exfiltration across three stages:

1. **Flight Recorder (`agentsiem_sdk`)**: Captures `INPUT_LOG`, `THOUGHT_LOG`, and `TOOL_CALL` events linked by a shared `trace_id`.
2. **OpenSearch Guard (`backend/opensearch_client.py` + `backend/detector.py`)**: Indexes telemetry into `agentsiem-telemetry`, checks behavioral policy rules, anomaly signals, and forbidden targets, and blocks suspicious tool calls before data egress.
3. **Gemini Forensic Detective (`backend/forensics.py`)**: Reads the complete `trace_id` timeline using `google-genai`, identifies the exact poisoned line, and saves an incident report + auto-protection rule into `agentsiem-incidents`.

## Repository Structure

```text
agentsiem/
├── LICENSE
├── README.md
├── docker-compose.yml
├── agentsiem_sdk/
│   ├── __init__.py
│   └── recorder.py
├── backend/
│   ├── requirements.txt
│   ├── opensearch_client.py
│   ├── detector.py
│   ├── forensics.py
│   └── main.py
└── examples/
    └── hr_bot_demo.py
```

## Quickstart

### 1. Start OpenSearch & OpenSearch Dashboards
```bash
docker compose up -d
```

### 2. Install Backend & SDK Dependencies
```bash
pip install -r backend/requirements.txt
```

### 3. Configure Environment Variables & Launch FastAPI
```bash
export GEMINI_API_KEY="your-gemini-api-key"
export OPENSEARCH_URL="http://localhost:9200"
uvicorn backend.main:app --reload --port 8000
```

### 4. Run the HR-Bot Clean vs. Poisoned Demo
```bash
python examples/hr_bot_demo.py
```
