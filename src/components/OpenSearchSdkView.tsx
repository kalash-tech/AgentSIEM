import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Database, Download, FileCode, Layers, Search, Send, Terminal } from 'lucide-react';
import type { AgentCase, BaselineProfile, SecurityRule, VectorSignature } from '../engine/types';
import { ApiHtmlResponseError, fetchJson } from '../lib/api';
import { getFallbackRepoFiles, runLocalIngestTest } from '../lib/siemClientFallback';

interface OpenSearchSdkViewProps {
  openSearchMode: string;
  openSearchIndex: string;
  rules: SecurityRule[];
  vectors: VectorSignature[];
  baseline: BaselineProfile;
  onIngestedCase: (caseData: AgentCase) => void;
}

interface RepoFile {
  path: string;
  language: string;
  sizeBytes: number;
  content: string;
}

export const OpenSearchSdkView: React.FC<OpenSearchSdkViewProps> = ({
  openSearchMode,
  openSearchIndex,
  rules,
  vectors,
  baseline,
  onIngestedCase,
}) => {
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('backend/detector.py');
  const [repoQuery, setRepoQuery] = useState<string>('');
  const [loadingRepo, setLoadingRepo] = useState<boolean>(true);
  const [repoError, setRepoError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);

  const [ingesting, setIngesting] = useState<boolean>(false);
  const [ingestResponse, setIngestResponse] = useState<string>('');
  const [ingestError, setIngestError] = useState<string>('');
  const [lastIngestedCase, setLastIngestedCase] = useState<AgentCase | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let loadedFiles: RepoFile[];
        try {
          const data = await fetchJson<{ files: RepoFile[] }>('/api/oss-repo');
          loadedFiles = data.files;
        } catch (err) {
          if (err instanceof ApiHtmlResponseError) {
            loadedFiles = getFallbackRepoFiles();
          } else {
            throw err;
          }
        }
        if (active) {
          setFiles(loadedFiles);
          if (loadedFiles.length > 0 && !loadedFiles.some((f) => f.path === 'backend/detector.py')) {
            setSelectedPath(loadedFiles[0].path);
          }
        }
      } catch (err) {
        if (active) {
          setRepoError(err instanceof Error ? err.message : 'Unable to load repository.');
        }
      } finally {
        if (active) setLoadingRepo(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filteredFiles = useMemo(() => {
    const q = repoQuery.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, repoQuery]);

  const currentFile = files.find((f) => f.path === selectedPath) ?? filteredFiles[0] ?? files[0] ?? null;

  const quickstartCommands = [
    'cd opensource/agentsiem',
    'docker compose up -d',
    'pip install -r backend/requirements.txt',
    'uvicorn backend.main:app --reload --port 8000',
    'python examples/hr_bot_demo.py',
  ].join('\n');

  const handleCopyQuickstart = async () => {
    try {
      await navigator.clipboard.writeText(quickstartCommands);
      setCopiedCmd(true);
      window.setTimeout(() => setCopiedCmd(false), 1500);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleCopy = async () => {
    if (!currentFile) return;
    try {
      await navigator.clipboard.writeText(currentFile.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleDownload = () => {
    if (!currentFile) return;
    const blob = new Blob([currentFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = currentFile.path.split('/').pop() || 'file.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleTestIngest = async () => {
    setIngesting(true);
    setIngestResponse('');
    setIngestError('');
    const traceId = `sdk_live_${Math.floor(100 + Math.random() * 900)}`;
    try {
      let data: {
        indexed_id: string;
        trace_id: string;
        is_suspicious: boolean;
        action: string;
        risk_score: number;
        reasons: string[];
        caseData?: AgentCase;
      };
      try {
        data = await fetchJson('/api/v1/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trace_id: traceId,
            agent: 'HR-Bot',
            step: 3,
            event_type: 'TOOL_CALL',
            action: 'call_tool',
            tool_name: 'read_file',
            target: '/company/passwords.txt',
            content:
              'FlightRecorder SDK live ingest test attempting read_file(/company/passwords.txt) -> http://hacker-site.com',
          }),
        });
      } catch (err) {
        if (err instanceof ApiHtmlResponseError) {
          data = runLocalIngestTest({ traceId, rules, vectors, baseline });
        } else {
          throw err;
        }
      }
      if (data.caseData) {
        setLastIngestedCase(data.caseData);
      }
      setIngestResponse(
        JSON.stringify(
          {
            indexed_id: data.indexed_id,
            trace_id: data.trace_id,
            is_suspicious: data.is_suspicious,
            action: data.action,
            risk_score: data.risk_score,
            reasons: data.reasons,
          },
          null,
          2
        )
      );
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : 'Live ingest request failed.');
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Architecture & Live Engine Summary */}
      <section
        aria-labelledby="architecture-heading"
        className="rounded-xl border border-zinc-800 bg-zinc-950 p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="architecture-heading" className="font-display text-base font-semibold text-white">
              Open-Source AgentSIEM Repository & Live Ingest API
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-zinc-400">
              Browse the complete Apache-2.0 open-source starter repository (<code className="rounded border border-zinc-800 bg-black px-1.5 py-0.5 font-mono text-zinc-200">agentsiem_sdk</code>, FastAPI backend with <code className="rounded border border-zinc-800 bg-black px-1.5 py-0.5 font-mono text-zinc-200">opensearch-py</code>, <code className="rounded border border-zinc-800 bg-black px-1.5 py-0.5 font-mono text-zinc-200">detector.py</code>, <code className="rounded border border-zinc-800 bg-black px-1.5 py-0.5 font-mono text-zinc-200">google-genai</code> forensics, and Docker Compose). You can also send live SDK telemetry to <code className="rounded border border-zinc-800 bg-black px-1.5 py-0.5 font-mono text-zinc-200">POST /api/v1/ingest</code>.
            </p>
          </div>

          <button
            type="button"
            onClick={handleTestIngest}
            disabled={ingesting}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-black transition-colors hover:bg-white disabled:opacity-60 whitespace-nowrap"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{ingesting ? 'Posting Event...' : 'Test POST /api/v1/ingest'}</span>
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-black/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-400">
              <Database className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Active Engine Mode</span>
            </div>
            <div className="mt-1.5 text-xs font-semibold text-zinc-100">
              {openSearchMode}
            </div>
          </div>

          <div className="p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-400">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Target Index</span>
            </div>
            <div className="mt-1.5 font-mono text-xs font-semibold text-zinc-100">
              {openSearchIndex}
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs font-medium text-zinc-400">Repository License</div>
            <div className="mt-1.5 text-xs font-semibold text-zinc-100">
              Apache-2.0 · OpenSearch 2.17 · FastAPI · Python SDK
            </div>
          </div>
        </div>

        {/* Local Open-Source Quickstart Commands */}
        <div className="mt-5 rounded-lg border border-zinc-800 bg-black p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <Terminal className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
              <span>Run Open-Source Stack Locally (Docker + FastAPI + HR-Bot Demo)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRepoQuery('');
                  setSelectedPath('README.md');
                }}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
              >
                Open README.md
              </button>
              <button
                type="button"
                onClick={handleCopyQuickstart}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-zinc-700 hover:bg-zinc-900 whitespace-nowrap"
              >
                {copiedCmd ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    <span>Commands Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Copy Quickstart</span>
                  </>
                )}
              </button>
            </div>
          </div>
          <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-zinc-300">
            {quickstartCommands}
          </pre>
        </div>

        {ingestError && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-900/70 bg-red-950/50 p-3 text-xs text-red-200"
          >
            {ingestError}
          </div>
        )}

        {ingestResponse && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-100">
                Live /api/v1/ingest Response
              </span>
              <button
                type="button"
                onClick={() => {
                  if (lastIngestedCase) {
                    onIngestedCase(lastIngestedCase);
                    return;
                  }
                  const parsed = JSON.parse(ingestResponse) as { trace_id: string };
                  onIngestedCase({
                    trace_id: parsed.trace_id,
                    agent: 'HR-Bot',
                    fileName: '/company/passwords.txt',
                    createdAt: new Date().toISOString(),
                    status: 'ALERT_BLOCKED',
                    pausedBeforeExfiltration: true,
                    events: [],
                    ruleHits: [],
                    anomaly: {
                      score: 90,
                      isAnomaly: true,
                      baselineReadCalls: 1,
                      observedReadCalls: 1,
                      baselineExternalCalls: 0,
                      observedExternalCalls: 1,
                      deviations: [],
                    },
                    vectorMatch: {
                      signatureId: 'vec_ignore_instructions',
                      label: 'SDK Ingest',
                      category: 'Live',
                      similarityPercent: 90,
                      isMatch: true,
                      matchedSnippet: '',
                    },
                  });
                }}
                className="font-semibold text-blue-400 hover:text-blue-300 hover:underline"
              >
                Open Ingested Trace in Live Lab
              </button>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-black p-4 font-mono text-xs text-zinc-200">
              {ingestResponse}
            </pre>
          </div>
        )}
      </section>

      {/* Open-Source Repository File Explorer */}
      <section
        aria-labelledby="oss-explorer-heading"
        className="rounded-xl border border-zinc-800 bg-zinc-950"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-6 py-3.5">
          <div>
            <h3 id="oss-explorer-heading" className="font-display text-sm font-semibold text-white">
              agentsiem Repository Blueprint ({files.length} files)
            </h3>
          </div>

          {currentFile && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-black px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-700 hover:bg-zinc-900 whitespace-nowrap"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Copy File</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-black px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-700 hover:bg-zinc-900 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Download</span>
              </button>
            </div>
          )}
        </div>

        {repoError ? (
          <div role="alert" className="p-6 text-xs text-red-400">
            {repoError}
          </div>
        ) : loadingRepo ? (
          <div className="p-6">
            <div className="h-48 animate-pulse rounded-lg bg-zinc-900" />
          </div>
        ) : (
          <div className="grid grid-cols-1 divide-y divide-zinc-800 lg:grid-cols-12 lg:divide-x lg:divide-y-0">
            {/* File Tree */}
            <div className="lg:col-span-4">
              <div className="border-b border-zinc-800 p-3">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={repoQuery}
                    onChange={(e) => setRepoQuery(e.target.value)}
                    placeholder="Filter repository files..."
                    aria-label="Filter repository files"
                    className="w-full rounded-md border border-zinc-800 bg-black py-1.5 pl-8 pr-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
              <nav
                aria-label="Open-source repository files"
                className="divide-y divide-zinc-800/70"
              >
                {filteredFiles.map((file) => {
                  const active = file.path === currentFile?.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => {
                        setSelectedPath(file.path);
                        setCopied(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-xs transition-colors ${
                        active
                          ? 'bg-blue-950/40 font-semibold text-blue-300'
                          : 'text-zinc-300 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate font-mono">
                        <FileCode className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                        <span className="truncate">{file.path}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-zinc-500 tabular-nums">
                        {file.sizeBytes}B
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Code Viewer */}
            <div className="p-5 lg:col-span-8">
              {currentFile && (
                <>
                  <div className="mb-2.5 flex items-center justify-between text-xs text-zinc-400">
                    <span className="font-mono font-semibold text-zinc-100">
                      {currentFile.path}
                    </span>
                    <span className="font-mono tabular-nums">
                      {currentFile.language} · {currentFile.sizeBytes} bytes
                    </span>
                  </div>
                  <pre className="max-h-[460px] overflow-auto rounded-lg border border-zinc-800 bg-black p-4 font-mono text-xs leading-relaxed text-zinc-200">
                    {currentFile.content}
                  </pre>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
