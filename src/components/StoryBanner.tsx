import React from 'react';
import { ArrowRight, Cpu, Play, ShieldAlert, Terminal } from 'lucide-react';

interface StoryBannerProps {
  onRunClean: () => void;
  onRunAttack: () => void;
  onInvestigateActive: () => void;
  isSimulating: boolean;
  isInvestigating: boolean;
  activeTraceId: string | null;
}

export const StoryBanner: React.FC<StoryBannerProps> = ({
  onRunClean,
  onRunAttack,
  onInvestigateActive,
  isSimulating,
  isInvestigating,
  activeTraceId,
}) => {
  return (
    <section
      aria-label="How AgentSIEM works in 3 steps"
      className="rounded-xl border border-zinc-800 bg-zinc-950"
    >
      <div className="grid grid-cols-1 divide-y divide-zinc-800 md:grid-cols-3 md:divide-x md:divide-y-0">
        {/* Step 1 */}
        <div className="flex flex-col justify-between gap-3 p-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
              <Terminal className="h-4 w-4 text-zinc-300" aria-hidden="true" />
              <span>Step 1 · Flight Recorder</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
              Like an airplane black box, it records every resume the AI reads, what it decides, and every tool it tries to run under one Case ID.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSimulating}
              onClick={onRunClean}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-black px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-60"
            >
              <Play className="h-3 w-3 text-emerald-400" aria-hidden="true" />
              <span>Try Clean Resume</span>
            </button>
            <button
              type="button"
              disabled={isSimulating}
              onClick={onRunAttack}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-black px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-60"
            >
              <Play className="h-3 w-3 text-red-400" aria-hidden="true" />
              <span>Try Hacked Resume</span>
            </button>
          </div>
        </div>

        {/* Step 2 */}
        <div className="flex flex-col justify-between gap-3 p-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
              <ShieldAlert className="h-4 w-4 text-red-400" aria-hidden="true" />
              <span>Step 2 · OpenSearch Security Guard</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
              Watches logs in real time with 3 checks: strict file rules, unusual behavior spikes, and AI meaning matching (k-NN)—pausing threats before data leaks.
            </p>
          </div>
          <a
            href="#step2-heading"
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 hover:underline"
          >
            <span>Jump to Guard Checks</span>
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>

        {/* Step 3 */}
        <div className="flex flex-col justify-between gap-3 p-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
              <Cpu className="h-4 w-4 text-blue-400" aria-hidden="true" />
              <span>Step 3 · Gemini Forensic Detective</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
              Reads the full Case ID story in seconds, highlights the exact hidden line that tricked the AI, and saves a new block rule automatically.
            </p>
          </div>
          <div>
            <button
              type="button"
              disabled={isInvestigating || !activeTraceId}
              onClick={onInvestigateActive}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
            >
              <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {isInvestigating
                  ? 'Investigating...'
                  : `Investigate ${activeTraceId ?? 'Case'} with Gemini`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
