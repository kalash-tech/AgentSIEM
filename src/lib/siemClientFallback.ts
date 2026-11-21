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
} from '../engine/siemEngine';
import type {
  AgentCase,
  BaselineProfile,
  FlightEvent,
  ResumeScenario,
  SecurityRule,
  VectorSignature,
} from '../engine/types';

import readmeRaw from '../../opensource/agentsiem/README.md?raw';
import licenseRaw from '../../opensource/agentsiem/LICENSE?raw';
import dockerComposeRaw from '../../opensource/agentsiem/docker-compose.yml?raw';
import sdkInitRaw from '../../opensource/agentsiem/agentsiem_sdk/__init__.py?raw';
import sdkRecorderRaw from '../../opensource/agentsiem/agentsiem_sdk/recorder.py?raw';
import requirementsRaw from '../../opensource/agentsiem/backend/requirements.txt?raw';
import osClientRaw from '../../opensource/agentsiem/backend/opensearch_client.py?raw';
import detectorRaw from '../../opensource/agentsiem/backend/detector.py?raw';
import forensicsRaw from '../../opensource/agentsiem/backend/forensics.py?raw';
import mainPyRaw from '../../opensource/agentsiem/backend/main.py?raw';
import hrDemoRaw from '../../opensource/agentsiem/examples/hr_bot_demo.py?raw';

export interface FallbackRepoFile {
  path: string;
  language: string;
  sizeBytes: number;
  content: string;
}

export interface FallbackState {
  cases: AgentCase[];
  rules: SecurityRule[];
  vectors: VectorSignature[];
  baseline: BaselineProfile;
  scenarios: ResumeScenario[];
  openSearchMode: string;
  openSearchIndex: string;
}

export function getFallbackInitialState(): FallbackState {
  return {
    cases: createInitialCases(),
    rules: INITIAL_RULES.map((r) => ({ ...r })),
    vectors: INITIAL_VECTORS.map((v) => ({ ...v })),
    baseline: { ...DEFAULT_BASELINE },
    scenarios: RESUME_SCENARIOS,
    openSearchMode: 'Embedded OpenSearch-Compatible Engine',
    openSearchIndex: 'agentsiem-logs',
  };
}

export function runLocalSimulation(params: {
  traceNumber: number;
  fileName: string;
  content: string;
  rules: SecurityRule[];
  vectors: VectorSignature[];
  baseline: BaselineProfile;
}): { caseData: AgentCase; rules: SecurityRule[] } {
  const cleanName = params.fileName.trim().slice(0, 120) || 'uploaded_resume.pdf';
  const extracted = extractTextFromUpload(cleanName, params.content);
  const traceId = `case_${params.traceNumber}`;

  const caseData = simulateHrBotTrace({
    traceId,
    fileName: cleanName,
    content: extracted,
    rules: params.rules,
    vectorSignatures: params.vectors,
    baseline: params.baseline,
  });

  const hitIds = new Set(caseData.ruleHits.map((h) => h.ruleId));
  const updatedRules = params.rules.map((r) =>
    hitIds.has(r.id) ? { ...r, hits: r.hits + 1 } : r
  );

  return { caseData, rules: updatedRules };
}

export function runLocalIngestTest(params: {
  traceId: string;
  rules: SecurityRule[];
  vectors: VectorSignature[];
  baseline: BaselineProfile;
}) {
  const nowIso = new Date().toISOString();
  const event: FlightEvent = {
    id: `${params.traceId}_step_3_${Date.now()}`,
    trace_id: params.traceId,
    agent: 'HR-Bot',
    step: 3,
    event_type: 'TOOL_CALL',
    action: 'call_tool',
    tool_name: 'read_file',
    target: '/company/passwords.txt',
    content:
      'FlightRecorder SDK live ingest test attempting read_file(/company/passwords.txt) -> http://hacker-site.com',
    timestamp: nowIso,
  };

  const ruleHits = evaluateSecurityRules([event], params.rules);
  const anomaly = evaluateBehavioralAnomaly([event], params.baseline);
  const vectorMatch = computeVectorSimilarity(
    event.content || '',
    params.vectors,
    params.baseline.similarityThreshold
  );
  const isSuspicious = ruleHits.length > 0 || anomaly.isAnomaly || vectorMatch.isMatch;
  if (isSuspicious) {
    event.blocked = true;
  }

  const reasons = [
    ...ruleHits.map((h) => h.reason),
    ...anomaly.deviations,
    ...(vectorMatch.isMatch
      ? [`k-NN similarity ${vectorMatch.similarityPercent}% (${vectorMatch.label})`]
      : []),
  ];

  const caseData: AgentCase = {
    trace_id: params.traceId,
    agent: 'HR-Bot',
    fileName: event.target || `${params.traceId}.log`,
    createdAt: nowIso,
    status: isSuspicious ? 'ALERT_BLOCKED' : 'NOMINAL',
    pausedBeforeExfiltration: isSuspicious,
    events: [event],
    ruleHits,
    anomaly,
    vectorMatch,
    maliciousHighlight: extractMaliciousSnippet(event.content || '') || undefined,
  };

  return {
    indexed_id: event.id,
    trace_id: params.traceId,
    is_suspicious: isSuspicious,
    action: isSuspicious ? 'PAUSE_AGENT' : 'ALLOW',
    risk_score: Math.max(
      anomaly.score,
      vectorMatch.similarityPercent,
      ruleHits.length > 0 ? 90 : 0
    ),
    reasons,
    caseData,
  };
}

export function getFallbackRepoFiles(): FallbackRepoFile[] {
  const entries: Array<{ path: string; language: string; content: string }> = [
    { path: 'README.md', language: 'markdown', content: readmeRaw },
    { path: 'LICENSE', language: 'text', content: licenseRaw },
    { path: 'docker-compose.yml', language: 'yaml', content: dockerComposeRaw },
    { path: 'agentsiem_sdk/__init__.py', language: 'python', content: sdkInitRaw },
    { path: 'agentsiem_sdk/recorder.py', language: 'python', content: sdkRecorderRaw },
    { path: 'backend/requirements.txt', language: 'text', content: requirementsRaw },
    { path: 'backend/opensearch_client.py', language: 'python', content: osClientRaw },
    { path: 'backend/detector.py', language: 'python', content: detectorRaw },
    { path: 'backend/forensics.py', language: 'python', content: forensicsRaw },
    { path: 'backend/main.py', language: 'python', content: mainPyRaw },
    { path: 'examples/hr_bot_demo.py', language: 'python', content: hrDemoRaw },
  ];

  const encoder = new TextEncoder();
  return entries.map((entry) => ({
    path: entry.path,
    language: entry.language,
    sizeBytes: encoder.encode(entry.content).byteLength,
    content: entry.content,
  }));
}

export function runLocalForensicInvestigation(
  targetCase: AgentCase,
  rules: SecurityRule[]
): { caseData: AgentCase; rules: SecurityRule[] } {
  const inputEv = targetCase.events.find((e) => e.event_type === 'INPUT_LOG');
  const toolEv = targetCase.events.find((e) => e.event_type === 'TOOL_CALL');
  const snippet =
    targetCase.maliciousHighlight ||
    extractMaliciousSnippet(inputEv?.content || '') ||
    'None detected';

  const isAttack =
    targetCase.status === 'ALERT_BLOCKED' ||
    targetCase.ruleHits.length > 0 ||
    targetCase.anomaly.isAnomaly ||
    targetCase.vectorMatch.isMatch;

  const lowerSnippet = snippet.toLowerCase();
  let pattern = 'ignore previous instructions';
  if (lowerSnippet.includes('ignore previous instructions')) {
    pattern = 'ignore previous instructions';
  } else if (lowerSnippet.includes('system override')) {
    pattern = 'system override';
  } else if (lowerSnippet.includes('developer mode')) {
    pattern = 'developer mode';
  } else if (lowerSnippet.includes('hidden text')) {
    pattern = 'hidden text';
  } else if (!isAttack) {
    pattern = 'ignore previous instructions';
  }

  const generatedRule = {
    name: isAttack
      ? `Auto-Block ${targetCase.trace_id} Injection Pattern`
      : 'Prevent Instruction Override Directives',
    description: isAttack
      ? `Blocks documents containing "${pattern}" at Step 1 before tool execution.`
      : 'Baseline instruction-override guard for candidate intake.',
    severity: 'CRITICAL' as const,
    field: 'content' as const,
    pattern,
    mode: 'contains' as const,
  };

  let nextRules = [...rules];
  let savedRuleId: string;
  const existing = nextRules.find(
    (r) =>
      r.pattern.toLowerCase() === generatedRule.pattern.toLowerCase() &&
      r.field === generatedRule.field
  );

  if (existing) {
    nextRules = nextRules.map((r) =>
      r.id === existing.id ? { ...r, enabled: true } : r
    );
    savedRuleId = existing.id;
  } else {
    savedRuleId = `rule_local_forensic_${Date.now()}`;
    const created: SecurityRule = {
      id: savedRuleId,
      name: generatedRule.name,
      description: generatedRule.description,
      severity: generatedRule.severity,
      field: generatedRule.field,
      pattern: generatedRule.pattern,
      mode: generatedRule.mode,
      enabled: true,
      source: 'Gemini Auto-Rule',
      createdAt: new Date().toISOString(),
      hits: 0,
    };
    nextRules = [created, ...nextRules];
  }

  const updatedCase: AgentCase = {
    ...targetCase,
    status: targetCase.status === 'ALERT_BLOCKED' ? 'RESOLVED' : targetCase.status,
    forensicReport: {
      generatedAt: new Date().toISOString(),
      model: 'local-forensic-analyzer',
      attackSummary: isAttack
        ? `Indirect Prompt Injection detected in "${targetCase.fileName}": hidden instructions attempted to override ${targetCase.agent} and exfiltrate ${toolEv?.target || 'sensitive files'}.`
        : `Nominal intake trace for "${targetCase.fileName}": no prompt injection or policy violations detected.`,
      rootCause: isAttack
        ? `Step 1 (${inputEv?.action || 'read_document'}) ingested embedded override directives inside "${targetCase.fileName}", causing ${targetCase.agent} to plan an unauthorized action at Step 2.`
        : `All ${targetCase.events.length} flight recorder steps matched the standard ${targetCase.agent} intake workflow.`,
      maliciousLine: isAttack ? snippet : 'None detected',
      impactAssessment: isAttack
        ? `OpenSearch Guard paused execution (${targetCase.ruleHits.length} rule hit(s), anomaly ${targetCase.anomaly.score}/100, k-NN ${targetCase.vectorMatch.similarityPercent}%) before ${toolEv?.target || 'sensitive data'} could be read or uploaded.`
        : 'Zero unauthorized file access or external network calls occurred.',
      recommendedAction: isAttack
        ? `Quarantine "${targetCase.fileName}" and keep the new Step-1 content rule ("${pattern}") enabled so identical payloads are blocked immediately on ingestion.`
        : 'No remediation required; continue baseline monitoring.',
      generatedRule,
      savedRuleId,
    },
  };

  return { caseData: updatedCase, rules: nextRules };
}

export function runLocalChatAssistant(params: {
  question: string;
  activeCase: AgentCase | null;
  cases: AgentCase[];
  rules: SecurityRule[];
  vectors: VectorSignature[];
  baseline: BaselineProfile;
}): string {
  const q = params.question.trim().toLowerCase();
  const c = params.activeCase ?? params.cases[0] ?? null;

  if (
    q.includes('sdk') ||
    q.includes('python') ||
    q.includes('integrat') ||
    q.includes('agentsiem_sdk') ||
    q.includes('recorder')
  ) {
    return [
      'To integrate agentsiem_sdk into a Python agent, wrap each stage with FlightRecorder:',
      '',
      'from agentsiem_sdk import FlightRecorder',
      'recorder = FlightRecorder(agent_name="HR-Bot", ingest_url="http://localhost:8000/api/v1/ingest")',
      'recorder.log_input("case_101", step=1, action="read_document", target="resume.pdf", content=doc_text)',
      'recorder.log_thought("case_101", step=2, action="ai_reasoning", content=reasoning_text)',
      'verdict = recorder.log_tool_call("case_101", step=3, tool_name="read_file", target=target_path)',
      'if verdict["action"] == "PAUSE_AGENT":',
      '    raise RuntimeError(f"Blocked by OpenSearch Guard: {verdict[\'reasons\']}")',
      '',
      'Open the "OpenSearch & SDK" tab to browse and download all 11 repository files.',
    ].join('\n');
  }

  if (
    q.includes('3') ||
    q.includes('layer') ||
    q.includes('opensearch') ||
    q.includes('guard') ||
    (q.includes('how') && q.includes('work'))
  ) {
    const enabledCount = params.rules.filter((r) => r.enabled).length;
    return [
      'OpenSearch Guard evaluates every Flight Recorder step across 3 real-time layers:',
      '',
      `1. Security Rules (${enabledCount} enabled): Instant policy checks on target, tool_name, and content (for example, allowing only .pdf and .csv, and blocking passwords, .env, and external http:// URLs).`,
      `2. Behavioral Anomaly Detection: Compares live tool frequency against the learned baseline (${params.baseline.avgReadFileCalls} file read avg, ${params.baseline.avgExternalCalls} external call avg) to flag unexpected spikes.`,
      `3. k-NN Vector Search (${params.vectors.length} attack signatures): Scores incoming document semantics against known prompt-injection and jailbreak patterns, firing an alert at >= ${params.baseline.similarityThreshold}% similarity.`,
    ].join('\n');
  }

  if (q.includes('rule') || q.includes('vector') || q.includes('signature')) {
    const enabledRules = params.rules
      .filter((r) => r.enabled)
      .map((r) => `• ${r.name} [${r.field} ${r.mode}: ${r.pattern}]`)
      .join('\n');
    const sigs = params.vectors.map((v) => `• ${v.label} (${v.category})`).join('\n');
    return [
      `Active Security Rules (${params.rules.filter((r) => r.enabled).length} enabled):`,
      enabledRules || '• None enabled',
      '',
      `Indexed k-NN Vector Signatures (threshold ${params.baseline.similarityThreshold}%):`,
      sigs,
    ].join('\n');
  }

  if (c) {
    const stepSummary = c.events
      .map(
        (ev) =>
          `• Step ${ev.step} (${ev.event_type}): ${ev.action}${ev.target ? ` -> ${ev.target}` : ''}${ev.blocked ? ' [PAUSED BY GUARD]' : ''}`
      )
      .join('\n');

    if (c.status === 'NOMINAL') {
      return [
        `Case ${c.trace_id} (${c.fileName}) is NOMINAL (safe):`,
        '',
        stepSummary,
        '',
        `• Rule hits: 0 | Anomaly score: ${c.anomaly.score}/100 | k-NN match: ${c.vectorMatch.similarityPercent}% (below ${params.baseline.similarityThreshold}% threshold).`,
      ].join('\n');
    }

    const reasonLines = [
      ...c.ruleHits.map((h) => `• Rule Hit (${h.ruleName}): ${h.reason}`),
      ...c.anomaly.deviations.map((d) => `• Anomaly: ${d}`),
      c.vectorMatch.isMatch
        ? `• Vector k-NN (${c.vectorMatch.similarityPercent}%): Matched "${c.vectorMatch.label}".`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return [
      `Why ${c.trace_id} (${c.fileName}) was ${c.status === 'RESOLVED' ? 'flagged and resolved' : 'blocked'}:`,
      '',
      c.maliciousHighlight
        ? `Hidden payload found at Step 1:\n"${c.maliciousHighlight}"`
        : 'Suspicious tool or content activity was detected in the trace timeline.',
      '',
      'Timeline:',
      stepSummary,
      '',
      'OpenSearch Guard Triggers:',
      reasonLines || `• Anomaly score ${c.anomaly.score}/100`,
    ].join('\n');
  }

  return `AgentSIEM currently tracks ${params.cases.length} case(s) with ${params.rules.filter((r) => r.enabled).length} active Guard rules and ${params.vectors.length} k-NN attack signatures. Select any case on the left or run a scan to inspect its timeline.`;
}
