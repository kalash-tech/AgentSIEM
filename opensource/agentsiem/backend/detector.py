from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

ALLOWED_EXTENSIONS = (".pdf", ".csv")
FORBIDDEN_PATHS = ("passwords", ".env", "id_rsa", "/etc/passwd", "secrets")
INJECTION_KEYWORDS = (
    "ignore previous instructions",
    "ignore all instructions",
    "system override",
    "developer mode",
    "hidden text",
    "bypass",
    "exfiltrate",
)


def evaluate_event_policy(
    event: Dict[str, Any],
    dynamic_blocked_phrases: List[str] | None = None,
) -> Tuple[bool, List[str], int]:
    """Evaluate policy rules & behavioral anomalies.

    Returns:
        (is_suspicious, reasons, risk_score)
    """
    reasons: List[str] = []
    risk_score = 0

    event_type = str(event.get("event_type", ""))
    target = str(event.get("target") or "")
    content = str(event.get("content") or "")
    tool_name = str(event.get("tool_name") or "")

    # 1. Extension allowlist check on tool calls
    if event_type == "TOOL_CALL" and target:
        target_lower = target.lower()
        if not target_lower.endswith(ALLOWED_EXTENSIONS):
            reasons.append(
                f"Target '{target}' violates allowed file extensions {ALLOWED_EXTENSIONS}."
            )
            risk_score += 40

    # 2. Forbidden credential paths
    combined_target = f"{target} {tool_name}".lower()
    for bad in FORBIDDEN_PATHS:
        if bad in combined_target:
            reasons.append(f"Sensitive target pattern '{bad}' detected in tool action.")
            risk_score += 45
            break

    # 3. External URL exfiltration attempt
    combined_text = f"{target} {content}"
    if re.search(r"https?://", combined_text, re.IGNORECASE):
        if event_type in ("TOOL_CALL", "THOUGHT_LOG"):
            reasons.append("Attempted external HTTP/HTTPS network exfiltration.")
            risk_score += 45

    # 4. Prompt injection phrases (static + Gemini auto-generated phrases)
    content_lower = content.lower()
    for phrase in INJECTION_KEYWORDS:
        if phrase in content_lower:
            reasons.append(f"Prompt injection signature matched: '{phrase}'.")
            risk_score += 35
            break

    for phrase in dynamic_blocked_phrases or []:
        if phrase and phrase.lower() in content_lower:
            reasons.append(f"Auto-protection rule matched phrase: '{phrase}'.")
            risk_score += 50

    clamped_score = min(100, risk_score)
    return (clamped_score >= 40 or len(reasons) > 0, reasons, clamped_score)
