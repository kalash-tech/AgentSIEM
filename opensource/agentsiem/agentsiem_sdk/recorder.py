from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional
import uuid
import httpx


class FlightRecorder:
    """Open-source telemetry plugin that records every AI agent step by trace_id."""

    def __init__(
        self,
        agent_name: str,
        ingest_url: str = "http://localhost:8000/api/v1/ingest",
        timeout_seconds: float = 5.0,
    ) -> None:
        self.agent_name = agent_name
        self.ingest_url = ingest_url
        self.timeout_seconds = timeout_seconds

    def new_trace(self, prefix: str = "case") -> str:
        return f"{prefix}_{uuid.uuid4().hex[:8]}"

    def emit(
        self,
        trace_id: str,
        step: int,
        event_type: str,
        action: str,
        content: Optional[str] = None,
        tool_name: Optional[str] = None,
        target: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "trace_id": trace_id,
            "agent": self.agent_name,
            "step": step,
            "event_type": event_type,
            "action": action,
            "content": content,
            "tool_name": tool_name,
            "target": target,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        with httpx.Client(timeout=self.timeout_seconds) as client:
            response = client.post(self.ingest_url, json=payload)
            response.raise_for_status()
            return response.json()

    def log_input(self, trace_id: str, step: int, action: str, content: str, target: Optional[str] = None) -> Dict[str, Any]:
        return self.emit(trace_id, step, "INPUT_LOG", action, content=content, target=target)

    def log_thought(self, trace_id: str, step: int, action: str, content: str) -> Dict[str, Any]:
        return self.emit(trace_id, step, "THOUGHT_LOG", action, content=content)

    def log_tool_call(
        self,
        trace_id: str,
        step: int,
        tool_name: str,
        target: str,
        content: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self.emit(
            trace_id,
            step,
            "TOOL_CALL",
            "call_tool",
            content=content,
            tool_name=tool_name,
            target=target,
        )
