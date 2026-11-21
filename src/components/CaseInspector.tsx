import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  FastForward,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { buildOpenSearchAlertMonitor, buildOpenSearchQueryDsl } from '../engine/siemEngine';
import type { AgentCase, FlightEvent, SecurityRule } from '../engine/types';

interface CaseInspectorProps {
  caseData: AgentCase | null;
  rules: SecurityRule[];
  openSearchIndex: string;
  autoPlayTraceId: string | null;
  onInvestigate: (traceId: string) => Promise<void>;
  onRetestFile: (fileName: string, content: string) => Promise<void>;
  isInvestigating: boolean;
  investigateError: string | null;
  isSimulating: boolean;
}

type GuardSubTab = 'checks' | 'dsl' | 'monitor';

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function renderHighlightedContent(text: string, highlight?: string) {
  if (!highlight || !text.includes(highlight)) {
    return <span>{text}</span>;
  }
  const idx = text.indexOf(highlight);
  const before = text.slice(0, idx);
  const after = text.slice(idx + highlight.length);
  return (
    <>
      <span>{before}</span>
      <mark className="rounded bg-red-950/90 px-1 py-0.5 font-semibold text-red-200 ring-1 ring-red-700/60">
        {highlight}
      </mark>
      <span>{after}</span>
    </>
  );
}

const EventRow: React.FC<{ event: FlightEvent; highlight?: string }> = ({
  event,
  highlight,
}) => {
  const [showRaw, setShowRaw] = useState(false);

  const eventLabel =
    event.event_type === 'INPUT_LOG'
      ? 'What the AI Read'
      : event.event_type === 'THOUGHT_LOG'
        ? 'What the AI Decided'
        : 'What Tool the AI Used';

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono font-semibold text-zinc-100 tabular-nums">
            Step {event.step}
          </span>
          <span aria-hidden="true" className="text-zinc-600">
            ·
          </span>
          <span className="font-mono text-zinc-300">{event.event_type}</span>
          <span aria-hidden="true" className="text-zinc-600">
            ·
          </span>
          <span className="font-medium text-zinc-300">{eventLabel}</span>
          {event.blocked && (
            <>
              <span aria-hidden="true" className="text-zinc-600">
                ·
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-red-900/80 bg-red-950/60 px-1.5 py-0.5 font-medium text-red-300">
                <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                Paused by Guard
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-zinc-500 tabular-nums">
            {formatTime(event.timestamp)}
          </span>
          <button
            type="button"
            onClick={() => setShowRaw((prev) => !prev)}
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-100"
          >
            {showRaw ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>JSON</span>
          </button>
        </div>
      </div>

      <div className="mt-2 rounded-lg border border-zinc-800 bg-black px-3.5 py-2.5 text-xs leading-relaxed text-zinc-200">
        <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-500">
          <span>action: {event.action}</span>
          {event.tool_name && (
            <>
              <span aria-hidden="true">·</span>
              <span>tool_name: {event.tool_name}</span>
            </>
          )}
          {event.target && (
            <>
              <span aria-hidden="true">·</span>
              <span>target: {event.target}</span>
            </>
          )}
        </div>
        {event.content && (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-zinc-100">
            {event.event_type === 'INPUT_LOG'
              ? renderHighlightedContent(event.content, highlight)
              : event.content}
          </pre>
        )}
        {event.blocked && (
          <div className="mt-2 border-t border-red-900/60 pt-2 text-xs font-medium text-red-300">
            Blocked before execution: OpenSearch Guard paused {event.agent} so no sensitive files or external links were accessed.
          </div>
        )}
      </div>

      {showRaw && (
        <pre className="mt-2 overflow-x-auto rounded-lg border border-zinc-800 bg-black p-3 font-mono text-xs text-zinc-200">
          {JSON.stringify(
            {
              trace_id: event.trace_id,
              agent: event.agent,
              step: event.step,
              event_type: event.event_type,
              action: event.action,
              ...(event.tool_name ? { tool_name: event.tool_name } : {}),
              ...(event.target ? { target: event.target } : {}),
              ...(event.content ? { content: event.content } : {}),
              ...(event.blocked ? { blocked: true } : {}),
            },
            null,
            2
          )}
        </pre>
      )}
    </div>
  );
};

export const CaseInspector: React.FC<CaseInspectorProps> = ({
  caseData,
  rules,
  openSearchIndex,
  autoPlayTraceId,
  onInvestigate,
  onRetestFile,
  isInvestigating,
  investigateError,
  isSimulating,
}) => {
  const [visibleSteps, setVisibleSteps] = useState<number>(3);
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [guardTab, setGuardTab] = useState<GuardSubTab>('checks');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const totalSteps = caseData?.events.length ?? 0;

  useEffect(() => {
    if (!caseData) return;
    if (autoPlayTraceId === caseData.trace_id && caseData.events.length > 1) {
      setVisibleSteps(1);
      setIsReplaying(true);
    } else {
      setVisibleSteps(caseData.events.length);
      setIsReplaying(false);
    }
  }, [caseData?.trace_id, autoPlayTraceId, caseData?.events.length]);

  useEffect(() => {
    if (!isReplaying || !caseData) return;
    if (visibleSteps >= caseData.events.length) {
      setIsReplaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setVisibleSteps((prev) => Math.min(caseData.events.length, prev + 1));
    }, 550);
    return () => window.clearTimeout(timer);
  }, [isReplaying, visibleSteps, caseData]);

  const dslJson = useMemo(() => {
    if (!caseData) return '';
    return JSON.stringify(buildOpenSearchQueryDsl(caseData, openSearchIndex), null, 2);
  }, [caseData, openSearchIndex]);

  const monitorJson = useMemo(() => {
    const activeRule =
      (caseData?.ruleHits[0]
        ? rules.find((r) => r.id === caseData.ruleHits[0].ruleId)
        : undefined) ?? rules[0];
    if (!activeRule) return '{}';
    return JSON.stringify(buildOpenSearchAlertMonitor(activeRule, openSearchIndex), null, 2);
  }, [caseData, rules, openSearchIndex]);

  if (!caseData) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-10 text-center">
        <p className="text-sm font-medium text-zinc-100">No trace selected</p>
        <p className="mt-1 text-xs text-zinc-400">
          Select a case trace on the left or run a new HR-Bot scan to inspect telemetry.
        </p>
      </div>
    );
  }

  const isAlert = caseData.status === 'ALERT_BLOCKED';
  const isResolved = caseData.status === 'RESOLVED';
  const inputEvent = caseData.events.find((e) => e.event_type === 'INPUT_LOG');
  const displayedEvents = caseData.events.slice(0, visibleSteps);
  const streamDone = visibleSteps >= totalSteps;

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Ignore clipboard failures in restricted frames
    }
  };

  return (
    <div className="space-y-6">
      {/* Active Case Banner + 3-Stage Pipeline Strip */}
      <section
        aria-label="Active case summary"
        className={`rounded-xl border bg-zinc-950 ${
          isAlert ? 'border-red-900/80' : 'border-zinc-800'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="font-mono font-semibold text-zinc-100 tabular-nums">
                {caseData.trace_id}
              </span>
              <span aria-hidden="true">·</span>
              <span>Agent: {caseData.agent}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{caseData.fileName}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{formatTime(caseData.createdAt)}</span>
            </div>

            <h2 className="mt-2 font-display text-xl font-bold tracking-tight text-white">
              {isAlert
                ? 'Security Alert: Unauthorized Exfiltration Attempt Paused'
                : isResolved
                  ? 'Incident Investigated & Auto-Protection Rule Deployed'
                  : 'Nominal Candidate Intake Completed'}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${
                isAlert
                  ? 'border-red-900/80 bg-red-950/60 text-red-300'
                  : isResolved
                    ? 'border-blue-900/80 bg-blue-950/60 text-blue-300'
                    : 'border-emerald-900/80 bg-emerald-950/60 text-emerald-300'
              }`}
            >
              {isAlert ? (
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>
                {isAlert
                  ? 'Alert · Blocked'
                  : isResolved
                    ? 'Resolved · Protected'
                    : 'Nominal'}
              </span>
            </span>

            {inputEvent?.content && (
              <button
                type="button"
                disabled={isSimulating}
                onClick={() => onRetestFile(caseData.fileName, inputEvent.content!)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-black px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-60 whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                <span>Re-test File</span>
              </button>
            )}
          </div>
        </div>

        {/* 3-Stage Architecture Pipeline Progress Strip */}
        <div className="grid grid-cols-1 divide-y divide-zinc-800 border-t border-zinc-800 bg-black/50 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-3">
            <div className="text-[11px] font-medium text-zinc-500">01. Flight Recorder</div>
            <div className="mt-0.5 text-xs font-semibold text-zinc-100 tabular-nums">
              {streamDone
                ? `${totalSteps} / ${totalSteps} events captured`
                : `Streaming step ${visibleSteps} of ${totalSteps}`}
            </div>
          </div>

          <div className="px-5 py-3">
            <div className="text-[11px] font-medium text-zinc-500">02. OpenSearch Guard</div>
            <div
              className={`mt-0.5 text-xs font-semibold tabular-nums ${
                !streamDone
                  ? 'text-zinc-400'
                  : isAlert || isResolved
                    ? 'text-red-400'
                    : 'text-emerald-400'
              }`}
            >
              {!streamDone
                ? 'Evaluating telemetry stream...'
                : isAlert || isResolved
                  ? `${caseData.ruleHits.length} rule hits · ${caseData.vectorMatch.similarityPercent}% k-NN`
                  : 'All 3 guard layers passed'}
            </div>
          </div>

          <div className="px-5 py-3">
            <div className="text-[11px] font-medium text-zinc-500">03. Gemini Forensics</div>
            <div
              className={`mt-0.5 text-xs font-semibold ${
                caseData.forensicReport ? 'text-blue-400' : 'text-zinc-300'
              }`}
            >
              {caseData.forensicReport
                ? 'Root cause & rule deployed'
                : isAlert
                  ? 'Ready for forensic triage'
                  : 'Standby (nominal trace)'}
            </div>
          </div>
        </div>
      </section>

      {/* Step 1: Flight Recorder Timeline with Live Playback Controls */}
      <section
        aria-labelledby="step1-heading"
        className="rounded-xl border border-zinc-800 bg-zinc-950"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-zinc-300" aria-hidden="true" />
            <h3 id="step1-heading" className="font-display text-sm font-semibold text-white">
              01. Flight Recorder Timeline
            </h3>
            <span className="text-xs text-zinc-400 tabular-nums">
              · {visibleSteps}/{totalSteps} steps
            </span>
          </div>

          {totalSteps > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isReplaying) {
                    setIsReplaying(false);
                  } else {
                    setVisibleSteps(1);
                    setIsReplaying(true);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-black px-2.5 py-1 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 whitespace-nowrap"
              >
                {isReplaying ? (
                  <>
                    <Pause className="h-3 w-3" aria-hidden="true" />
                    <span>Pause Stream</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3" aria-hidden="true" />
                    <span>Replay Stream</span>
                  </>
                )}
              </button>

              {!streamDone && (
                <button
                  type="button"
                  onClick={() => {
                    setIsReplaying(false);
                    setVisibleSteps(totalSteps);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-black px-2.5 py-1 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 whitespace-nowrap"
                >
                  <FastForward className="h-3 w-3" aria-hidden="true" />
                  <span>Show All</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="divide-y divide-zinc-800/80 px-5 py-4">
          {displayedEvents.map((ev) => (
            <EventRow key={ev.id} event={ev} highlight={caseData.maliciousHighlight} />
          ))}
        </div>
      </section>

      {/* Step 2: OpenSearch Guard (3-Layer Detection + Query DSL / Alert Monitor) */}
      <section
        aria-labelledby="step2-heading"
        className="rounded-xl border border-zinc-800 bg-zinc-950"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-zinc-300" aria-hidden="true" />
            <h3 id="step2-heading" className="font-display text-sm font-semibold text-white">
              02. OpenSearch Guard Checks
            </h3>
          </div>

          <div
            role="tablist"
            aria-label="OpenSearch inspection views"
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-black p-1"
          >
            {(
              [
                { id: 'checks', label: 'Detection Layers' },
                { id: 'dsl', label: 'Query DSL' },
                { id: 'monitor', label: 'Alert Monitor' },
              ] as const
            ).map((tab) => {
              const active = guardTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setGuardTab(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {guardTab === 'checks' ? (
          <div className="grid grid-cols-1 divide-y divide-zinc-800 md:grid-cols-3 md:divide-x md:divide-y-0">
            {/* Layer 1: Security Rules */}
            <div className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-100">
                  1. Security Rules
                </span>
                <span
                  className={`text-xs font-semibold tabular-nums ${
                    caseData.ruleHits.length > 0 ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {caseData.ruleHits.length > 0
                    ? `${caseData.ruleHits.length} Hit${caseData.ruleHits.length > 1 ? 's' : ''}`
                    : 'Clear'}
                </span>
              </div>

              {caseData.ruleHits.length === 0 ? (
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                  All tool invocations stayed within allowed extensions and safe target paths.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-zinc-800/80 border-t border-zinc-800/80">
                  {caseData.ruleHits.map((hit, i) => (
                    <li key={`${hit.ruleId}-${i}`} className="py-2.5 text-xs">
                      <div className="font-semibold text-red-300">{hit.ruleName}</div>
                      <div className="mt-0.5 text-zinc-400">{hit.reason}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Layer 2: Anomaly Detection */}
            <div className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-100">
                  2. Anomaly Detection
                </span>
                <span
                  className={`font-mono text-xs font-semibold tabular-nums ${
                    caseData.anomaly.isAnomaly ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {caseData.anomaly.score} / 100
                </span>
              </div>

              <div className="mt-2.5 space-y-1.5 text-xs text-zinc-400 tabular-nums">
                <div className="flex justify-between">
                  <span>Read File Calls</span>
                  <span className="font-mono text-zinc-100">
                    {caseData.anomaly.observedReadCalls} vs {caseData.anomaly.baselineReadCalls} avg
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>External Network Targets</span>
                  <span className="font-mono text-zinc-100">
                    {caseData.anomaly.observedExternalCalls} vs{' '}
                    {caseData.anomaly.baselineExternalCalls} avg
                  </span>
                </div>
              </div>

              {caseData.anomaly.deviations.length > 0 ? (
                <ul className="mt-2.5 space-y-1 text-xs text-red-300">
                  {caseData.anomaly.deviations.map((dev, idx) => (
                    <li key={idx}>• {dev}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2.5 text-xs text-zinc-400">
                  Execution cadence matches learned HR-Bot behavioral baseline.
                </p>
              )}
            </div>

            {/* Layer 3: Vector Search / k-NN */}
            <div className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-100">
                  3. Vector Search (k-NN)
                </span>
                <span
                  className={`font-mono text-xs font-semibold tabular-nums ${
                    caseData.vectorMatch.isMatch ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {caseData.vectorMatch.similarityPercent}% Match
                </span>
              </div>

              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full transition-all duration-300 ${
                    caseData.vectorMatch.isMatch ? 'bg-red-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${caseData.vectorMatch.similarityPercent}%` }}
                />
              </div>

              <div className="mt-2.5 text-xs font-medium text-zinc-100">
                {caseData.vectorMatch.label}
              </div>
              {caseData.vectorMatch.matchedSnippet && (
                <p className="mt-2 border-t border-zinc-800/80 pt-2 font-mono text-[11px] leading-relaxed text-zinc-400 break-words">
                  {caseData.vectorMatch.matchedSnippet}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="p-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-400">
                {guardTab === 'dsl'
                  ? `OpenSearch _search Query DSL + k-NN filter for ${caseData.trace_id}`
                  : 'OpenSearch Alerting Monitor JSON (_plugins/_alerting/monitors)'}
              </span>
              <button
                type="button"
                onClick={() =>
                  handleCopy(guardTab, guardTab === 'dsl' ? dslJson : monitorJson)
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-black px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-zinc-700 hover:bg-zinc-900"
              >
                {copiedId === guardTab ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-black p-4 font-mono text-xs leading-relaxed text-zinc-200">
              {guardTab === 'dsl' ? dslJson : monitorJson}
            </pre>
          </div>
        )}
      </section>

      {/* Step 3: Google Gemini Forensic Detective */}
      <section
        aria-labelledby="step3-heading"
        className="rounded-xl border border-zinc-800 bg-zinc-950"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-blue-400" aria-hidden="true" />
            <h3 id="step3-heading" className="font-display text-sm font-semibold text-white">
              03. Google Gemini Forensic Detective
            </h3>
          </div>

          <button
            type="button"
            disabled={isInvestigating}
            onClick={() => onInvestigate(caseData.trace_id)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
          >
            <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {isInvestigating
                ? 'Investigating Timeline...'
                : caseData.forensicReport
                  ? 'Re-run Gemini Investigation'
                  : 'Investigate with Gemini'}
            </span>
          </button>
        </div>

        <div className="p-5">
          {investigateError && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-900/70 bg-red-950/50 p-3.5 text-xs text-red-200"
            >
              <div className="font-semibold">Forensic API Error</div>
              <div className="mt-1">{investigateError}</div>
            </div>
          )}

          {isInvestigating ? (
            <div className="space-y-3" aria-busy="true" aria-label="Generating Gemini forensic report">
              <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
              <div className="h-16 w-full animate-pulse rounded bg-zinc-900" />
              <div className="h-24 w-full animate-pulse rounded bg-zinc-900" />
            </div>
          ) : caseData.forensicReport ? (
            <div data-testid="forensic-report" className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-zinc-400">Attack Summary</div>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-100">
                    {caseData.forensicReport.attackSummary}
                  </p>
                </div>

                <div>
                  <div className="text-xs font-semibold text-zinc-400">Root Cause</div>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-100">
                    {caseData.forensicReport.rootCause}
                  </p>
                </div>
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <div className="text-xs font-semibold text-zinc-400">
                  Exact Offending Line Identified
                </div>
                <pre className="mt-1.5 overflow-x-auto rounded-lg border border-red-900/70 bg-red-950/40 p-3 font-mono text-xs text-red-200">
                  {caseData.forensicReport.maliciousLine}
                </pre>
              </div>

              <div className="grid grid-cols-1 gap-4 border-t border-zinc-800 pt-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-zinc-400">Impact & Mitigation</div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-300">
                    {caseData.forensicReport.impactAssessment}
                  </p>
                </div>
                <div>
                  <div className="text-xs font-semibold text-zinc-400">Recommended Action</div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-300">
                    {caseData.forensicReport.recommendedAction}
                  </p>
                </div>
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                    <span className="text-xs font-semibold text-zinc-100">
                      Auto-Protection Rule Saved to OpenSearch
                    </span>
                  </div>
                  {inputEvent?.content && (
                    <button
                      type="button"
                      disabled={isSimulating}
                      onClick={() => onRetestFile(caseData.fileName, inputEvent.content!)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-white disabled:opacity-60"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Re-test Attack Now</span>
                    </button>
                  )}
                </div>

                <pre className="mt-2 overflow-x-auto rounded-lg border border-zinc-800 bg-black p-3.5 font-mono text-xs text-zinc-200">
                  {JSON.stringify(caseData.forensicReport.generatedRule, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Ready for automated root-cause forensics
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Send the complete sorted timeline for{' '}
                  <span className="font-mono font-medium text-zinc-100">{caseData.trace_id}</span>{' '}
                  to Gemini to pinpoint the exact malicious prompt injection line and automatically deploy a blocking rule to OpenSearch.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
