import React from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import type { AgentCase } from '../engine/types';

interface CaseListRailProps {
  cases: AgentCase[];
  selectedTraceId: string | null;
  onSelectCase: (traceId: string) => void;
}

export const CaseListRail: React.FC<CaseListRailProps> = ({
  cases,
  selectedTraceId,
  onSelectCase,
}) => {
  return (
    <section
      aria-labelledby="recent-traces-heading"
      className="rounded-xl border border-zinc-800 bg-zinc-950"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
        <h2
          id="recent-traces-heading"
          className="font-display text-sm font-semibold text-white"
        >
          Recorded Flight Traces
        </h2>
        <span className="text-xs text-zinc-400 tabular-nums">{cases.length} total</span>
      </div>

      {cases.length === 0 ? (
        <div className="px-5 py-6 text-center text-xs text-zinc-500">
          No flight traces recorded yet.
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/80">
          {cases.map((c) => {
            const active = c.trace_id === selectedTraceId;
            const isAlert = c.status === 'ALERT_BLOCKED';
            const isResolved = c.status === 'RESOLVED';

            return (
              <button
                key={c.trace_id}
                type="button"
                onClick={() => onSelectCase(c.trace_id)}
                className={`flex w-full items-start justify-between gap-3 px-5 py-3.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-500 ${
                  active ? 'bg-blue-950/30' : 'hover:bg-zinc-900/60'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono font-semibold text-zinc-100 tabular-nums">
                      {c.trace_id}
                    </span>
                    <span aria-hidden="true" className="text-zinc-600">
                      ·
                    </span>
                    <span className="truncate font-mono text-zinc-400">{c.fileName}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500 tabular-nums">
                    <span>{c.events.length} steps</span>
                    <span aria-hidden="true">·</span>
                    <span>Anomaly {c.anomaly.score}/100</span>
                    <span aria-hidden="true">·</span>
                    <span>k-NN {c.vectorMatch.similarityPercent}%</span>
                  </div>
                </div>

                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold ${
                    isAlert
                      ? 'border-red-900/80 bg-red-950/60 text-red-300'
                      : isResolved
                        ? 'border-blue-900/80 bg-blue-950/60 text-blue-300'
                        : 'border-emerald-900/80 bg-emerald-950/60 text-emerald-300'
                  }`}
                >
                  {isAlert ? (
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  ) : isResolved ? (
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  )}
                  <span>
                    {isAlert ? 'Blocked' : isResolved ? 'Resolved' : 'Nominal'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
