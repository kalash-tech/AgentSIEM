from __future__ import annotations

import json
import os
from typing import Any, Dict, List
from google import genai
from google.genai import types
from pydantic import BaseModel, Field


class GeneratedRule(BaseModel):
    name: str = Field(description="Short rule name")
    pattern: str = Field(description="Lowercase substring to block on Step 1")
    severity: str = Field(description="CRITICAL, HIGH, or MEDIUM")


class ForensicReport(BaseModel):
    attack_summary: str
    root_cause: str
    malicious_line: str
    impact_assessment: str
    generated_rule: GeneratedRule


def investigate_trace_with_gemini(
    trace_id: str,
    timeline: List[Dict[str, Any]],
) -> Dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is required for forensics.")

    client = genai.Client(api_key=api_key)
    model_name = os.getenv("GEMINI_MODEL", "gemini-4-hydrogen")

    prompt = (
        f"You are the AgentSIEM Digital Forensic Detective.\n"
        f"Analyze the chronological telemetry timeline for trace_id='{trace_id}':\n\n"
        f"{json.dumps(timeline, indent=2)}\n\n"
        "Identify the attack summary, root cause, exact offending line verbatim, "
        "attempted impact, and emit a lowercase substring pattern for an auto-protection rule."
    )

    response = client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ForensicReport,
        ),
    )

    return json.loads(response.text)
