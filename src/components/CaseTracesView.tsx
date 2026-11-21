import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Search, ShieldCheck } from 'lucide-react';
import type { AgentCase, CaseStatus } from '../engine/types';

interface CaseTracesViewProps {
  cases: AgentCase[];
  onInspectCase: (traceId: string) => void;
}

type StatusFilter = 'ALL' | CaseStatus;

export const CaseTracesView: React.FC<CaseTracesViewProps> = ({
  cases,
  onInspectCase,
}) => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const eventText = c.events.map((e) => `${e.content ?? ''} ${e.target ?? ''}`).join(' ');
      return (
        c.trace_id.toLowerCase().includes(q) ||
        c.fileName.toLowerCase().includes(q) ||
        c.agent.toLowerCase().includes(q) ||
        eventText.toLowerCase().includes(q)
      );
    });
  }, [cases, query, statusFilter]);

  const filters: Array<{ id: StatusFilter; label: string }> = [
    { id: 'ALL', label: 'All Traces' },
    { id: 'ALERT_BLOCKED', label: 'Blocked' },
    { id: 'RESOLVED', label: 'Resolved' },
    { id: 'NOMINAL', label: 'Nominal' },
  ];

  return (
    <section
      aria-labelledby="traces-heading"
      className="rounded-xl border border-zinc-800 bg-zinc-950"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 px-6 py-4">
        <div>
          <h2 id="traces-heading" className="font-display text-base font-semibold text-white">
            Flight Recorder Case Index
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Every HR-Bot task grouped by trace_id across input, reasoning, and tool execution steps.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search trace ID, file, or text..."
              aria-label="Search case traces"
              className="w-60 rounded-lg border border-zinc-800 bg-black py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div
            role="group"
            aria-label="Filter traces by status"
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-black p-1"
          >
            {filters.map((f) => {
              const active = statusFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-zinc-100">No matching case traces</p>
          <p className="mt-1 text-xs text-zinc-400">
            Clear your search query or switch status filters to view recorded runs.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-black/60 text-zinc-400">
                <th className="px-6 py-3 font-semibold">Trace ID</th>
                <th className="px-4 py-3 font-semibold">Document</th>
                <th className="px-4 py-3 font-semibold text-right">Steps</th>
                <th className="px-4 py-3 font-semibold text-right">Rule Hits</th>
                <th className="px-4 py-3 font-semibold text-right">Anomaly</th>
                <th className="px-4 py-3 font-semibold text-right">Vector k-NN</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {filtered.map((c) => {
                const isAlert = c.status === 'ALERT_BLOCKED';
                const isResolved = c.status === 'RESOLVED';

                return (
                  <tr key={c.trace_id} className="hover:bg-zinc-900/50">
                    <td className="px-6 py-3 font-mono font-semibold text-zinc-100 tabular-nums whitespace-nowrap">
                      {c.trace_id}
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-300 max-w-[220px] truncate">
                      {c.fileName}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300 tabular-nums">
                      {c.events.length}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300 tabular-nums">
                      {c.ruleHits.length}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-100 tabular-nums">
                      {c.anomaly.score}/100
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-100 tabular-nums">
                      {c.vectorMatch.similarityPercent}%
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold ${
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
                          {isAlert
                            ? 'Alert · Blocked'
                            : isResolved
                              ? 'Resolved'
                              : 'Nominal'}
                        </span>
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onInspectCase(c.trace_id)}
                        className="text-xs font-semibold text-blue-400 hover:text-blue-300 hover:underline"
                      >
                        Inspect Timeline
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
