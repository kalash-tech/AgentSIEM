import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  computeVectorSimilarity,
  createInitialCases,
  DEFAULT_BASELINE,
  evaluateBehavioralAnomaly,
  evaluateSecurityRules,
  extractMaliciousSnippet,
  extractTextFromUpload,
  INITIAL_RULES,
  INITIAL_VECTORS,
  RESUME_SCENARIOS,
  simulateHrBotTrace,
} from './src/engine/siemEngine.ts';
import type {
  AgentCase,
  EventType,
  FlightEvent,
  ForensicReport,
  RuleMatchField,
  RuleSeverity,
  SecurityRule,
  VectorSignature,
} from './src/engine/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

interface SiemStore {
  cases: AgentCase[];
  rules: SecurityRule[];
  vectors: VectorSignature[];
  baseline: typeof DEFAULT_BASELINE;
  nextCaseNumber: number;
}

function getOpenSearchConfig() {
  const rawUrl = (process.env.OPENSEARCH_URL || '').trim().replace(/\/+$/, '');
  const indexName = (process.env.OPENSEARCH_INDEX || 'agentsiem-logs').trim();
  return {
    url: rawUrl,
    indexName,
    isExternal: Boolean(rawUrl),
    modeLabel: rawUrl
      ? `External OpenSearch Cluster (${indexName})`
      : 'Embedded OpenSearch-Compatible Engine',
  };
}

async function shipEventsToOpenSearch(caseData: AgentCase) {
  const cfg = getOpenSearchConfig();
  if (!cfg.isExternal) return;
  try {
    const parsed = new URL(cfg.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    for (const ev of caseData.events) {
      await fetch(`${cfg.url}/${encodeURIComponent(cfg.indexName)}/_doc/${encodeURIComponent(ev.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ev),
        signal: AbortSignal.timeout(3000),
      });
    }
  } catch {
    // Keep embedded store authoritative if external OpenSearch cluster is unreachable
  }
}

function createFreshStore(): SiemStore {
  return {
    cases: createInitialCases(),
    rules: INITIAL_RULES.map((r) => ({ ...r })),
    vectors: INITIAL_VECTORS.map((v) => ({ ...v })),
    baseline: { ...DEFAULT_BASELINE },
    nextCaseNumber: 100,
  };
}

let store: SiemStore = createFreshStore();

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractGeminiErrorInfo(err: unknown): {
  message: string;
  isTransient: boolean;
  isKeyIssue: boolean;
  isQuotaIssue: boolean;
} {
  const rawMessage = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  let friendlyMessage = rawMessage;
  try {
    const parsedErr = JSON.parse(rawMessage) as { error?: { message?: string; status?: string } };
    if (parsedErr?.error?.message) {
      friendlyMessage = parsedErr.error.message;
    }
  } catch {
    // Keep rawMessage when not JSON
  }

  const lower = rawMessage.toLowerCase();
  const isTransient =
    rawMessage.includes('503') ||
    rawMessage.includes('UNAVAILABLE') ||
    lower.includes('timed out') ||
    lower.includes('high demand');
  const isKeyIssue =
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('401') ||
    rawMessage.includes('403') ||
    lower.includes('api key not valid');
  const isQuotaIssue =
    rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('429');

  return { message: friendlyMessage, isTransient, isKeyIssue, isQuotaIssue };
}

async function callGeminiWithRetry<T>(
  runner: (modelName: string) => Promise<T>
): Promise<{ result: T; modelUsed: string }> {
  const attempts: Array<{ model: string; backoffMs: number }> = [
    { model: 'gemini-4-hydrogen', backoffMs: 500 },
    { model: 'gemini-3.1-flash-lite', backoffMs: 1200 },
    { model: 'gemini-3.1-flash-lite', backoffMs: 0 },
  ];

  let lastErr: unknown;
  for (let i = 0; i < attempts.length; i += 1) {
    const { model, backoffMs } = attempts[i];
    try {
      const result = await runner(model);
      return { result, modelUsed: model };
    } catch (err) {
      lastErr = err;
      const info = extractGeminiErrorInfo(err);
      if (!info.isTransient || i === attempts.length - 1) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, backoffMs + jitter));
    }
  }
  throw lastErr;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, casesCount: store.cases.length, rulesCount: store.rules.length });
  });

  app.get('/api/state', (_req, res) => {
    const osCfg = getOpenSearchConfig();
    res.json({
      cases: store.cases,
      rules: store.rules,
      vectors: store.vectors,
      baseline: store.baseline,
      scenarios: RESUME_SCENARIOS,
      openSearchMode: osCfg.modeLabel,
      openSearchIndex: osCfg.indexName,
    });
  });

  app.post('/api/reset', (_req, res) => {
    store = createFreshStore();
    const osCfg = getOpenSearchConfig();
    res.json({
      cases: store.cases,
      rules: store.rules,
      vectors: store.vectors,
      baseline: store.baseline,
      scenarios: RESUME_SCENARIOS,
      openSearchMode: osCfg.modeLabel,
      openSearchIndex: osCfg.indexName,
    });
  });

  app.patch('/api/baseline', (req, res) => {
    const body = req.body as {
      similarityThreshold?: unknown;
      avgReadFileCalls?: unknown;
    };
    if (typeof body.similarityThreshold === 'number') {
      store.baseline.similarityThreshold = Math.max(
        50,
        Math.min(95, Math.round(body.similarityThreshold))
      );
    }
    if (typeof body.avgReadFileCalls === 'number') {
      store.baseline.avgReadFileCalls = Math.max(
        1,
        Math.min(5, Math.round(body.avgReadFileCalls))
      );
    }
    res.json({ baseline: store.baseline });
  });

  app.post('/api/simulate', (req, res) => {
    const body = req.body as {
      fileName?: unknown;
      content?: unknown;
    };

    if (typeof body.content !== 'string' || !body.content.trim()) {
      res.status(400).json({ error: 'Resume content must be a non-empty string.' });
      return;
    }

    const rawFileName =
      typeof body.fileName === 'string' && body.fileName.trim()
        ? body.fileName.trim().slice(0, 120)
        : 'uploaded_resume.pdf';

    const extractedContent = extractTextFromUpload(rawFileName, body.content);
    const traceId = `case_${store.nextCaseNumber++}`;

    const newCase = simulateHrBotTrace({
      traceId,
      fileName: rawFileName,
      content: extractedContent,
      rules: store.rules,
      vectorSignatures: store.vectors,
      baseline: store.baseline,
    });

    // Increment rule hit counters in store
    const hitRuleIds = new Set(newCase.ruleHits.map((h) => h.ruleId));
    for (const rule of store.rules) {
      if (hitRuleIds.has(rule.id)) {
        rule.hits += 1;
      }
    }

    store.cases = [newCase, ...store.cases];
    void shipEventsToOpenSearch(newCase);
    res.status(201).json({
      caseData: newCase,
      rules: store.rules,
    });
  });

  app.post('/api/investigate/:traceId', async (req, res) => {
    const { traceId } = req.params;
    const targetCase = store.cases.find((c) => c.trace_id === traceId);

    if (!targetCase) {
      res.status(404).json({ error: `Trace "${traceId}" was not found.` });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured in the server environment. Add a valid key in Settings > Secrets to run Gemini Forensic Investigation.',
      });
      return;
    }

    const sortedEvents = [...targetCase.events].sort((a, b) => a.step - b.step);

    const prompt = [
      `You are the AgentSIEM Digital Forensic Detective analyzing an AI agent security incident.`,
      `Analyze the complete chronological telemetry timeline for trace_id="${targetCase.trace_id}" (agent="${targetCase.agent}", fileName="${targetCase.fileName}").`,
      ``,
      `Sorted Flight Recorder Events:`,
      JSON.stringify(sortedEvents, null, 2),
      ``,
      `OpenSearch Guard Findings:`,
      JSON.stringify(
        {
          ruleHits: targetCase.ruleHits,
          anomaly: targetCase.anomaly,
          vectorMatch: targetCase.vectorMatch,
        },
        null,
        2
      ),
      ``,
      `Instructions:`,
      `1. Produce a concise Attack Summary naming the attack class (e.g., Indirect Prompt Injection or Nominal Task).`,
      `2. Identify the exact Root Cause (which step and document introduced the hijack).`,
      `3. Quote the exact offending malicious line or phrase from the document verbatim in maliciousLine (or "None detected" if nominal).`,
      `4. Explain the Impact & Mitigation (what sensitive target or external destination was attempted, and whether execution was paused).`,
      `5. Generate one concrete, non-empty Auto-Protection JSON Rule that inspects field="content" (or "any") with a short lowercase substring or regex pattern that blocks this exact trick at Step 1 in future runs.`,
    ].join('\n');

    try {
      const timeoutMs = 12000;
      const runForensics = (modelName: string) =>
        Promise.race([
          ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              systemInstruction:
                'You are a digital forensics security analyst for AI agent telemetry. Return precise, factual JSON matching the requested schema.',
              ...(modelName === 'gemini-4-hydrogen'
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : {}),
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  attackSummary: {
                    type: Type.STRING,
                    description: 'Concise 1-2 sentence summary of the incident.',
                  },
                  rootCause: {
                    type: Type.STRING,
                    description: 'Which step and mechanism caused the agent to deviate.',
                  },
                  maliciousLine: {
                    type: Type.STRING,
                    description: 'Exact quoted malicious line or phrase from the input document.',
                  },
                  impactAssessment: {
                    type: Type.STRING,
                    description: 'Attempted impact and whether OpenSearch paused execution in time.',
                  },
                  recommendedAction: {
                    type: Type.STRING,
                    description: 'Short remediation guidance for the security operator.',
                  },
                  generatedRule: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      description: { type: Type.STRING },
                      severity: {
                        type: Type.STRING,
                        description: 'One of CRITICAL, HIGH, or MEDIUM',
                      },
                      field: {
                        type: Type.STRING,
                        description: 'One of content, target, tool_name, or any',
                      },
                      pattern: {
                        type: Type.STRING,
                        description:
                          'Short lowercase phrase or regex pattern to match against incoming logs at Step 1.',
                      },
                      mode: {
                        type: Type.STRING,
                        description: 'Either contains or regex',
                      },
                    },
                    required: ['name', 'description', 'severity', 'field', 'pattern', 'mode'],
                  },
                },
                required: [
                  'attackSummary',
                  'rootCause',
                  'maliciousLine',
                  'impactAssessment',
                  'recommendedAction',
                  'generatedRule',
                ],
              },
            },
          }),
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    'Gemini API request timed out after 12s. Check network connectivity and GEMINI_API_KEY in Settings > Secrets.'
                  )
                ),
              timeoutMs
            )
          ),
        ]);

      const { result: response, modelUsed } = await callGeminiWithRetry(runForensics);

      const rawJson = (response.text ?? '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      if (!rawJson) {
        res.status(502).json({ error: 'Gemini returned an empty forensic response.' });
        return;
      }

      const parsed = JSON.parse(rawJson) as Partial<
        Omit<ForensicReport, 'generatedAt' | 'model' | 'savedRuleId'>
      >;
      const rawRule: Partial<ForensicReport['generatedRule']> =
        parsed.generatedRule && typeof parsed.generatedRule === 'object'
          ? parsed.generatedRule
          : {};

      const validSeverities: RuleSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM'];
      const validFields: RuleMatchField[] = ['content', 'target', 'tool_name', 'any'];
      const severity: RuleSeverity =
        rawRule.severity && validSeverities.includes(rawRule.severity)
          ? rawRule.severity
          : 'CRITICAL';
      const field: RuleMatchField =
        rawRule.field && validFields.includes(rawRule.field) ? rawRule.field : 'content';
      const pattern =
        typeof rawRule.pattern === 'string' && rawRule.pattern.trim()
          ? rawRule.pattern.trim()
          : 'ignore previous instructions';

      let mode: 'contains' | 'regex' = rawRule.mode === 'regex' ? 'regex' : 'contains';
      if (mode === 'regex') {
        try {
          new RegExp(pattern, 'i');
        } catch {
          mode = 'contains';
        }
      }

      // Save the Auto-Protection Rule directly into the active OpenSearch rule engine
      const existingSamePattern = store.rules.find(
        (r) => r.pattern.toLowerCase() === pattern.toLowerCase() && r.field === field
      );

      let savedRuleId: string;
      if (existingSamePattern) {
        existingSamePattern.enabled = true;
        savedRuleId = existingSamePattern.id;
      } else {
        savedRuleId = `rule_gemini_${Date.now()}`;
        const newRule: SecurityRule = {
          id: savedRuleId,
          name:
            typeof rawRule.name === 'string' && rawRule.name.trim()
              ? rawRule.name.trim()
              : `Gemini Auto-Block (${traceId})`,
          description:
            typeof rawRule.description === 'string' && rawRule.description.trim()
              ? rawRule.description.trim()
              : `Auto-generated forensic protection rule from ${traceId}.`,
          severity,
          field,
          pattern,
          mode,
          enabled: true,
          source: 'Gemini Auto-Rule',
          createdAt: new Date().toISOString(),
          hits: 0,
        };
        store.rules = [newRule, ...store.rules];
      }

      const report: ForensicReport = {
        generatedAt: new Date().toISOString(),
        model: modelUsed,
        attackSummary:
          typeof parsed.attackSummary === 'string' && parsed.attackSummary.trim()
            ? parsed.attackSummary.trim()
            : `Forensic review completed for ${traceId}.`,
        rootCause:
          typeof parsed.rootCause === 'string' && parsed.rootCause.trim()
            ? parsed.rootCause.trim()
            : 'Prompt injection directive influenced downstream tool execution.',
        maliciousLine:
          typeof parsed.maliciousLine === 'string' && parsed.maliciousLine.trim()
            ? parsed.maliciousLine.trim()
            : 'None detected',
        impactAssessment:
          typeof parsed.impactAssessment === 'string' && parsed.impactAssessment.trim()
            ? parsed.impactAssessment.trim()
            : 'OpenSearch Guard evaluated the trace timeline.',
        recommendedAction:
          typeof parsed.recommendedAction === 'string' && parsed.recommendedAction.trim()
            ? parsed.recommendedAction.trim()
            : 'Keep the deployed auto-protection rule enabled.',
        generatedRule: {
          name:
            typeof rawRule.name === 'string' && rawRule.name.trim()
              ? rawRule.name.trim()
              : `Gemini Auto-Block (${traceId})`,
          description:
            typeof rawRule.description === 'string' && rawRule.description.trim()
              ? rawRule.description.trim()
              : `Auto-generated forensic protection rule from ${traceId}.`,
          severity,
          field,
          pattern,
          mode,
        },
        savedRuleId,
      };

      targetCase.forensicReport = report;
      if (targetCase.status === 'ALERT_BLOCKED') {
        targetCase.status = 'RESOLVED';
      }

      res.json({
        caseData: targetCase,
        rules: store.rules,
      });
    } catch (err) {
      const info = extractGeminiErrorInfo(err);
      res.status(502).json({
        error: info.isKeyIssue
          ? 'Gemini API rejected the configured GEMINI_API_KEY. Please check or update your key in Settings > Secrets.'
          : info.isQuotaIssue
            ? 'Gemini API quota exceeded. Check billing or limits in Settings > Secrets.'
            : `Gemini Forensic Investigation failed: ${info.message}`,
      });
    }
  });

  app.post('/api/chat', async (req, res) => {
    const body = req.body as {
      messages?: unknown;
      activeTraceId?: unknown;
    };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({ error: 'Chat messages array is required.' });
      return;
    }

    const sanitizedMessages = body.messages
      .slice(-20)
      .filter(
        (m): m is { role: string; text: string } =>
          Boolean(m) &&
          typeof m === 'object' &&
          typeof (m as { text?: unknown }).text === 'string' &&
          Boolean((m as { text: string }).text.trim())
      )
      .map((m) => ({
        role: m.role === 'model' || m.role === 'assistant' ? ('model' as const) : ('user' as const),
        text: m.text.trim().slice(0, 4000),
      }));

    if (sanitizedMessages.length === 0 || sanitizedMessages[sanitizedMessages.length - 1].role !== 'user') {
      res.status(400).json({ error: 'Latest chat message must be a non-empty user message.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured in the server environment. Add your key in Settings > Secrets to chat with the AgentSIEM AI Assistant.',
      });
      return;
    }

    const activeTraceId = typeof body.activeTraceId === 'string' ? body.activeTraceId.trim() : '';
    const activeCase =
      (activeTraceId ? store.cases.find((c) => c.trace_id === activeTraceId) : undefined) ??
      store.cases[0] ??
      null;

    const osCfg = getOpenSearchConfig();
    const systemInstruction = [
      'You are the AgentSIEM AI Security Assistant, an expert open-source AI security engineer helping users understand and operate AgentSIEM.',
      'Explain concepts in plain, concise, practical language unless the user asks for technical JSON or code details.',
      'Be strictly factual based on the live workspace state below.',
      '',
      `Workspace State:`,
      `- OpenSearch Mode: ${osCfg.modeLabel} (index: ${osCfg.indexName})`,
      `- Total Cases: ${store.cases.length} (${store.cases.filter((c) => c.status === 'ALERT_BLOCKED').length} blocked, ${store.cases.filter((c) => c.status === 'RESOLVED').length} resolved, ${store.cases.filter((c) => c.status === 'NOMINAL').length} nominal)`,
      `- Active Security Rules (${store.rules.filter((r) => r.enabled).length} enabled): ${store.rules
        .filter((r) => r.enabled)
        .map((r) => `${r.name} [${r.field} ${r.mode}: ${r.pattern}]`)
        .join('; ')}`,
      `- Vector Signatures (${store.vectors.length}): ${store.vectors.map((v) => v.label).join(', ')} (k-NN alert threshold: ${store.baseline.similarityThreshold}%)`,
      activeCase
        ? [
            `- Currently Selected Case: ${activeCase.trace_id} (${activeCase.fileName}, status=${activeCase.status})`,
            `  - Events: ${activeCase.events
              .map((e) => `Step ${e.step} ${e.event_type} (${e.action}${e.target ? ` -> ${e.target}` : ''}${e.blocked ? ' [BLOCKED]' : ''})`)
              .join(' | ')}`,
            `  - Rule Hits: ${activeCase.ruleHits.map((h) => `${h.ruleName}: ${h.reason}`).join('; ') || 'None'}`,
            `  - Anomaly Score: ${activeCase.anomaly.score}/100 (reads: ${activeCase.anomaly.observedReadCalls} vs ${activeCase.anomaly.baselineReadCalls} avg, external: ${activeCase.anomaly.observedExternalCalls} vs ${activeCase.anomaly.baselineExternalCalls} avg)`,
            `  - Vector k-NN Match: ${activeCase.vectorMatch.similarityPercent}% (${activeCase.vectorMatch.label})`,
          ].join('\n')
        : '- No active case selected.',
    ].join('\n');

    const historyMessages = sanitizedMessages.slice(0, -1);
    const latestMessage = sanitizedMessages[sanitizedMessages.length - 1].text;

    try {
      const timeoutMs = 12000;
      const sendWithModel = async (modelName: string) => {
        const chat = ai.chats.create({
          model: modelName,
          config: {
            systemInstruction,
            ...(modelName === 'gemini-4-hydrogen'
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
          },
          history: historyMessages.map((m) => ({
            role: m.role,
            parts: [{ text: m.text }],
          })),
        });

        return Promise.race([
          chat.sendMessage({ message: latestMessage }),
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    'Gemini chat request timed out after 12s. Verify network connectivity and GEMINI_API_KEY in Settings > Secrets.'
                  )
                ),
              timeoutMs
            )
          ),
        ]);
      };

      const { result: response, modelUsed } = await callGeminiWithRetry(sendWithModel);

      const reply = (response.text ?? '').trim();
      if (!reply) {
        res.status(502).json({ error: 'Gemini returned an empty reply.' });
        return;
      }

      res.json({
        reply,
        model: modelUsed,
        contextTraceId: activeCase?.trace_id ?? null,
      });
    } catch (err) {
      const info = extractGeminiErrorInfo(err);
      res.status(502).json({
        error: info.isKeyIssue
          ? 'Gemini API rejected the configured GEMINI_API_KEY. Please check or update your key in Settings > Secrets.'
          : info.isQuotaIssue
            ? 'Gemini API quota exceeded. Check billing or limits in Settings > Secrets.'
            : `Gemini Chat failed: ${info.message}`,
      });
    }
  });

  app.post('/api/rules', (req, res) => {
    const body = req.body as {
      name?: unknown;
      description?: unknown;
      severity?: unknown;
      field?: unknown;
      pattern?: unknown;
      mode?: unknown;
    };

    if (typeof body.name !== 'string' || !body.name.trim()) {
      res.status(400).json({ error: 'Rule name is required.' });
      return;
    }
    if (typeof body.pattern !== 'string' || !body.pattern.trim()) {
      res.status(400).json({ error: 'Rule pattern is required.' });
      return;
    }

    const severity: RuleSeverity =
      body.severity === 'HIGH' || body.severity === 'MEDIUM' ? body.severity : 'CRITICAL';
    const field: RuleMatchField =
      body.field === 'target' || body.field === 'tool_name' || body.field === 'any'
        ? body.field
        : 'content';
    const mode: 'contains' | 'regex' | 'allowlist_extension' =
      body.mode === 'regex' || body.mode === 'allowlist_extension' ? body.mode : 'contains';

    if (mode === 'regex') {
      try {
        new RegExp(body.pattern.trim(), 'i');
      } catch {
        res.status(400).json({ error: 'Invalid regular expression pattern.' });
        return;
      }
    }

    const rule: SecurityRule = {
      id: `rule_custom_${Date.now()}`,
      name: body.name.trim(),
      description:
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : 'Custom security detection rule.',
      severity,
      field,
      pattern: body.pattern.trim(),
      mode,
      enabled: true,
      source: 'Custom',
      createdAt: new Date().toISOString(),
      hits: 0,
    };

    store.rules = [rule, ...store.rules];
    res.status(201).json({ rule, rules: store.rules });
  });

  app.patch('/api/rules/:id', (req, res) => {
    const { id } = req.params;
    const rule = store.rules.find((r) => r.id === id);
    if (!rule) {
      res.status(404).json({ error: 'Rule not found.' });
      return;
    }
    if (typeof req.body?.enabled === 'boolean') {
      rule.enabled = req.body.enabled;
    }
    res.json({ rule, rules: store.rules });
  });

  app.delete('/api/rules/:id', (req, res) => {
    const { id } = req.params;
    const existing = store.rules.find((r) => r.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Rule not found.' });
      return;
    }
    store.rules = store.rules.filter((r) => r.id !== id);
    res.json({ rules: store.rules });
  });

  app.post('/api/vectors/probe', (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) {
      res.status(400).json({ error: 'Probe text is required.' });
      return;
    }
    const match = computeVectorSimilarity(
      text,
      store.vectors,
      store.baseline.similarityThreshold
    );
    res.json({ match });
  });

  app.post('/api/vectors', (req, res) => {
    const body = req.body as {
      label?: unknown;
      category?: unknown;
      samplePhrase?: unknown;
      severity?: unknown;
    };

    if (typeof body.label !== 'string' || !body.label.trim()) {
      res.status(400).json({ error: 'Signature label is required.' });
      return;
    }
    if (typeof body.samplePhrase !== 'string' || !body.samplePhrase.trim()) {
      res.status(400).json({ error: 'Sample phrase is required.' });
      return;
    }

    const keywords = Array.from(
      new Set(
        body.samplePhrase
          .toLowerCase()
          .replace(/[^a-z0-9 ]+/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 3)
      )
    ).slice(0, 10);

    const newSig: VectorSignature = {
      id: `vec_${Date.now()}`,
      label: body.label.trim(),
      category:
        typeof body.category === 'string' && body.category.trim()
          ? body.category.trim()
          : 'Custom Injection',
      samplePhrase: body.samplePhrase.trim(),
      keywords,
      severity:
        body.severity === 'HIGH' || body.severity === 'MEDIUM' ? body.severity : 'CRITICAL',
    };

    store.vectors = [newSig, ...store.vectors];
    res.status(201).json({ vector: newSig, vectors: store.vectors });
  });

  app.post('/api/v1/ingest', (req, res) => {
    const body = req.body as {
      trace_id?: unknown;
      agent?: unknown;
      step?: unknown;
      event_type?: unknown;
      action?: unknown;
      content?: unknown;
      tool_name?: unknown;
      target?: unknown;
      timestamp?: unknown;
    };

    if (typeof body.trace_id !== 'string' || !body.trace_id.trim()) {
      res.status(400).json({ error: 'trace_id is required.' });
      return;
    }
    const traceId = body.trace_id.trim().slice(0, 64);
    const agent =
      typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim() : 'HR-Bot';
    const step = typeof body.step === 'number' && Number.isFinite(body.step) ? body.step : 1;
    const validTypes: EventType[] = ['INPUT_LOG', 'THOUGHT_LOG', 'TOOL_CALL'];
    const eventType: EventType = validTypes.includes(body.event_type as EventType)
      ? (body.event_type as EventType)
      : 'INPUT_LOG';
    const action =
      typeof body.action === 'string' && body.action.trim()
        ? body.action.trim()
        : 'read_document';

    const newEvent: FlightEvent = {
      id: `${traceId}_step_${step}_${Date.now()}`,
      trace_id: traceId,
      agent,
      step,
      event_type: eventType,
      action,
      content: typeof body.content === 'string' ? body.content : undefined,
      tool_name: typeof body.tool_name === 'string' ? body.tool_name : undefined,
      target: typeof body.target === 'string' ? body.target : undefined,
      timestamp:
        typeof body.timestamp === 'string' && body.timestamp.trim()
          ? body.timestamp
          : new Date().toISOString(),
    };

    let targetCase = store.cases.find((c) => c.trace_id === traceId);
    if (!targetCase) {
      targetCase = {
        trace_id: traceId,
        agent,
        fileName: newEvent.target || `${traceId}.log`,
        createdAt: newEvent.timestamp,
        status: 'NOMINAL',
        pausedBeforeExfiltration: false,
        events: [newEvent],
        ruleHits: [],
        anomaly: evaluateBehavioralAnomaly([newEvent], store.baseline),
        vectorMatch: computeVectorSimilarity(
          newEvent.content || '',
          store.vectors,
          store.baseline.similarityThreshold
        ),
      };
      store.cases = [targetCase, ...store.cases];
    } else {
      targetCase.events = [...targetCase.events, newEvent].sort((a, b) => a.step - b.step);
    }

    const priorHitRuleIds = new Set(targetCase.ruleHits.map((h) => h.ruleId));
    targetCase.ruleHits = evaluateSecurityRules(targetCase.events, store.rules);
    targetCase.anomaly = evaluateBehavioralAnomaly(targetCase.events, store.baseline);
    const inputContent = targetCase.events
      .map((e) => e.content || '')
      .filter(Boolean)
      .join('\n');
    targetCase.vectorMatch = computeVectorSimilarity(
      inputContent,
      store.vectors,
      store.baseline.similarityThreshold
    );
    const snippet = extractMaliciousSnippet(inputContent);
    if (snippet) {
      targetCase.maliciousHighlight = snippet;
    }

    const isSuspicious =
      targetCase.ruleHits.length > 0 ||
      targetCase.anomaly.isAnomaly ||
      targetCase.vectorMatch.isMatch;

    if (isSuspicious) {
      newEvent.blocked = true;
      targetCase.status = 'ALERT_BLOCKED';
      targetCase.pausedBeforeExfiltration = true;
    }

    void shipEventsToOpenSearch(targetCase);

    const reasons = [
      ...targetCase.ruleHits.map((h) => h.reason),
      ...targetCase.anomaly.deviations,
      ...(targetCase.vectorMatch.isMatch
        ? [`k-NN similarity ${targetCase.vectorMatch.similarityPercent}% (${targetCase.vectorMatch.label})`]
        : []),
    ];

    const hitRuleIds = new Set(targetCase.ruleHits.map((h) => h.ruleId));
    for (const rule of store.rules) {
      if (hitRuleIds.has(rule.id) && !priorHitRuleIds.has(rule.id)) {
        rule.hits += 1;
      }
    }

    res.status(201).json({
      indexed_id: newEvent.id,
      trace_id: traceId,
      is_suspicious: isSuspicious,
      action: isSuspicious ? 'PAUSE_AGENT' : 'ALLOW',
      risk_score: Math.max(
        targetCase.anomaly.score,
        targetCase.vectorMatch.similarityPercent,
        targetCase.ruleHits.length > 0 ? 90 : 0
      ),
      reasons,
      caseData: targetCase,
      rules: store.rules,
    });
  });

  app.get('/api/oss-repo', async (_req, res) => {
    const repoRoot = path.resolve(__dirname, 'opensource', 'agentsiem');
    const orderedRelativePaths = [
      'README.md',
      'LICENSE',
      'docker-compose.yml',
      'agentsiem_sdk/__init__.py',
      'agentsiem_sdk/recorder.py',
      'backend/requirements.txt',
      'backend/opensearch_client.py',
      'backend/detector.py',
      'backend/forensics.py',
      'backend/main.py',
      'examples/hr_bot_demo.py',
    ];

    try {
      const files = await Promise.all(
        orderedRelativePaths.map(async (relPath) => {
          const resolved = path.resolve(repoRoot, relPath);
          if (!resolved.startsWith(repoRoot + path.sep)) {
            throw new Error(`Invalid repository path: ${relPath}`);
          }
          const content = await fs.readFile(resolved, 'utf8');
          const ext = path.extname(relPath).toLowerCase();
          const language =
            ext === '.py'
              ? 'python'
              : ext === '.yml' || ext === '.yaml'
                ? 'yaml'
                : ext === '.md'
                  ? 'markdown'
                  : 'text';
          return {
            path: relPath,
            language,
            sizeBytes: Buffer.byteLength(content, 'utf8'),
            content,
          };
        })
      );
      res.json({ repoName: 'agentsiem', files });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load open-source repository files.';
      res.status(500).json({ error: msg });
    }
  });

  // Never allow unmatched /api/* routes or Express errors to fall through to HTML SPA responses
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    });
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      if (req.path.startsWith('/api')) {
        const status =
          typeof err === 'object' &&
          err !== null &&
          'status' in err &&
          typeof (err as { status?: unknown }).status === 'number'
            ? (err as { status: number }).status
            : 500;
        const message =
          err instanceof Error ? err.message : 'Internal API server error.';
        res.status(status).json({ error: message });
        return;
      }
      next(err);
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AgentSIEM server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
