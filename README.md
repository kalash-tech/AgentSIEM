# 🛡️ AgentSIEM

**Open-Source Flight Recorder & Digital Forensics SIEM for Autonomous AI Agents**  
*Powered by OpenSearch & Google Gemini*

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![OpenSearch](https://img.shields.io/badge/OpenSearch-2.15-005EB8.svg)](https://opensearch.org/)
[![Google Gemini](https://img.shields.io/badge/Google%20Gemini-2.5%20Flash-4285F4.svg)](https://ai.google.dev/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB.svg)](https://www.python.org/)

---

## 🚨 The Problem

AI Agents are no longer just chatbots—they read documents, query databases, call APIs, and execute system tools. If an attacker hides an **Indirect Prompt Injection** inside a PDF, email, or webpage, the AI Agent can be hijacked to leak secrets or run unauthorized commands.

Traditional firewalls and SIEMs are blind to this because every action looks like an authorized application call.

## 💡 The Solution: AgentSIEM

**AgentSIEM** acts like an airplane's **Black Box Flight Recorder + Security Guard** for AI Agents:

1. **Flight Recorder SDK (`agentsiem_sdk`):** Silently logs every input, AI reasoning step, and tool call with a shared `trace_id`.
2. **Real-Time Detection (`OpenSearch`):** Indexes all agent telemetry into OpenSearch (`agentsiem-telemetry`) and flags suspicious behavior (prompt injection patterns, unauthorized file/URL targets, and anomalous tool calls).
3. **Forensic Detective (`Google Gemini`):** When an alert fires, Gemini reads the full chronological trace from OpenSearch, identifies the exact poisoned input that hijacked the AI, explains the attack in plain English, and generates a recommended blocking rule—saved to `agentsiem-incidents`.

---

## 🏗️ Architecture

```text
[ AI Agent + AgentFlightRecorder SDK ]
                 │
                 ▼  (Telemetry Events: INPUT_LOG, THOUGHT_LOG, TOOL_CALL)
      [ FastAPI Ingestion & Detector ]
                 │
                 ▼
         [ OpenSearch Engine ]  ──► Stores Telemetry & Incidents
                 │
                 ▼  (When suspicious behavior is flagged)
       [ Google Gemini API ]    ──► Forensic Root-Cause Analysis & Auto-Rule
                 │
                 ▼
[ Live SOC Web UI (:8000) & OpenSearch Dashboards (:5601) ]
