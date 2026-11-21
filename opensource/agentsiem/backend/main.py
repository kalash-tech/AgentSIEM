from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .detector import evaluate_event_policy
from .forensics import investigate_trace_with_gemini
from .opensearch_client import (
    ensure_indices,
    get_opensearch_client,
    get_trace_timeline,
    index_incident_report,
    index_telemetry_event,
    list_incidents,
)

app = FastAPI(title="AgentSIEM API", version="1.0.0")
DYNAMIC_BLOCKED_PHRASES: List[str] = []


class TelemetryEvent(BaseModel):
    trace_id: str
    agent: str
    step: int
    event_type: str
    action: str
    content: Optional[str] = None
    tool_name: Optional[str] = None
    target: Optional[str] = None
    timestamp: Optional[str] = None


@app.on_event("startup")
def startup_event() -> None:
    client = get_opensearch_client()
    ensure_indices(client)


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"status": "ok", "dynamic_rules_count": len(DYNAMIC_BLOCKED_PHRASES)}


@app.post("/api/v1/ingest")
def ingest_event(event: TelemetryEvent) -> Dict[str, Any]:
    client = get_opensearch_client()
    event_dict = event.model_dump()
    if not event_dict.get("timestamp"):
        event_dict["timestamp"] = datetime.now(timezone.utc).isoformat()

    doc_id = index_telemetry_event(client, event_dict)
    is_suspicious, reasons, risk_score = evaluate_event_policy(
        event_dict, DYNAMIC_BLOCKED_PHRASES
    )

    if is_suspicious:
        index_incident_report(
            client,
            {
                "trace_id": event.trace_id,
                "agent": event.agent,
                "risk_score": risk_score,
                "reasons": reasons,
                "status": "PAUSED_BY_GUARD",
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    return {
        "indexed_id": doc_id,
        "trace_id": event.trace_id,
        "is_suspicious": is_suspicious,
        "action": "PAUSE_AGENT" if is_suspicious else "ALLOW",
        "risk_score": risk_score,
        "reasons": reasons,
    }


@app.post("/api/v1/investigate/{trace_id}")
def investigate_trace(trace_id: str) -> Dict[str, Any]:
    client = get_opensearch_client()
    timeline = get_trace_timeline(client, trace_id)
    if not timeline:
        raise HTTPException(status_code=404, detail=f"No telemetry found for {trace_id}")

    report = investigate_trace_with_gemini(trace_id, timeline)
    pattern = report.get("generated_rule", {}).get("pattern", "")
    if pattern and pattern not in DYNAMIC_BLOCKED_PHRASES:
        DYNAMIC_BLOCKED_PHRASES.append(pattern)

    incident = {
        "trace_id": trace_id,
        "risk_score": 95,
        "status": "INVESTIGATED_AND_RULE_SAVED",
        "forensic_report": report,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    index_incident_report(client, incident)
    return {"trace_id": trace_id, "forensic_report": report, "active_rules": DYNAMIC_BLOCKED_PHRASES}


@app.get("/api/v1/incidents")
def get_incidents() -> Dict[str, Any]:
    client = get_opensearch_client()
    return {"incidents": list_incidents(client)}
