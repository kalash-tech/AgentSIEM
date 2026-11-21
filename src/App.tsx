import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type {
  AgentCase,
  BaselineProfile,
  ResumeScenario,
  RuleMatchField,
  RuleSeverity,
  SecurityRule,
  VectorMatch,
  VectorSignature,
} from './engine/types';
import { DEFAULT_BASELINE } from './engine/siemEngine';
import { TopBar, type ActiveTab } from './components/TopBar';
import { KpiStrip } from './components/KpiStrip';
import { LiveTestBench } from './components/LiveTestBench';
import { CaseListRail } from './components/CaseListRail';
import { CaseInspector } from './components/CaseInspector';
import { CaseTracesView } from './components/CaseTracesView';
import { RulesEngineView } from './components/RulesEngineView';
import { VectorStoreView } from './components/VectorStoreView';
import { OpenSearchSdkView } from './components/OpenSearchSdkView';
import { StoryBanner } from './components/StoryBanner';
import { AiChatbot } from './components/AiChatbot';
import { ApiHtmlResponseError, fetchJson } from './lib/api';
import { computeVectorSimilarity } from './engine/siemEngine';
import {
  getFallbackInitialState,
  runLocalForensicInvestigation,
  runLocalSimulation,
} from './lib/siemClientFallback';

interface ApiStateResponse {
  cases: AgentCase[];
  rules: SecurityRule[];
  vectors: VectorSignature[];
  baseline: BaselineProfile;
  scenarios: ResumeScenario[];
  openSearchMode: string;
  openSearchIndex: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('live');
  const [cases, setCases] = useState<AgentCase[]>([]);
  const [rules, setRules] = useState<SecurityRule[]>([]);
  const [vectors, setVectors] = useState<VectorSignature[]>([]);
  const [baseline, setBaseline] = useState<BaselineProfile>(DEFAULT_BASELINE);
  const [scenarios, setScenarios] = useState<ResumeScenario[]>([]);
  const [openSearchMode, setOpenSearchMode] = useState<string>(
    'Embedded OpenSearch-Compatible Engine'
  );
  const [openSearchIndex, setOpenSearchIndex] = useState<string>('agentsiem-logs');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [autoPlayTraceId, setAutoPlayTraceId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [isInvestigating, setIsInvestigating] = useState<boolean>(false);
  const [investigateError, setInvestigateError] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState<boolean>(true);
  const [localOnlyMode, setLocalOnlyMode] = useState<boolean>(false);
  const [nextLocalCaseNumber, setNextLocalCaseNumber] = useState<number>(100);

  const loadState = useCallback(async () => {
    setLoading(true);
    setBannerError(null);
    try {
      const data = await fetchJson<ApiStateResponse>('/api/state');
      setLocalOnlyMode(false);
      setCases(data.cases);
      setRules(data.rules);
      setVectors(data.vectors);
      setBaseline(data.baseline);
      setScenarios(data.scenarios);
      setOpenSearchMode(data.openSearchMode);
      setOpenSearchIndex(data.openSearchIndex);
      setSelectedTraceId((prev) =>
        prev && data.cases.some((c) => c.trace_id === prev)
          ? prev
          : data.cases[0]?.trace_id ?? null
      );
    } catch (err) {
      if (err instanceof ApiHtmlResponseError) {
        const fallback = getFallbackInitialState();
        setLocalOnlyMode(true);
        setCases(fallback.cases);
        setRules(fallback.rules);
        setVectors(fallback.vectors);
        setBaseline(fallback.baseline);
        setScenarios(fallback.scenarios);
        setOpenSearchMode(fallback.openSearchMode);
        setOpenSearchIndex(fallback.openSearchIndex);
        setSelectedTraceId((prev) =>
          prev && fallback.cases.some((c) => c.trace_id === prev)
            ? prev
            : fallback.cases[0]?.trace_id ?? null
        );
      } else {
        setBannerError(
          err instanceof Error ? err.message : 'Unable to load AgentSIEM state.'
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const handleSimulate = async (fileName: string, content: string) => {
    setIsSimulating(true);
    setBannerError(null);
    setInvestigateError(null);
    try {
      let result: { caseData: AgentCase; rules: SecurityRule[] };
      if (localOnlyMode) {
        result = runLocalSimulation({
          traceNumber: nextLocalCaseNumber,
          fileName,
          content,
          rules,
          vectors,
          baseline,
        });
        setNextLocalCaseNumber((n) => n + 1);
      } else {
        try {
          result = await fetchJson<{ caseData: AgentCase; rules: SecurityRule[] }>(
            '/api/simulate',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName, content }),
            }
          );
        } catch (err) {
          if (err instanceof ApiHtmlResponseError) {
            setLocalOnlyMode(true);
            result = runLocalSimulation({
              traceNumber: nextLocalCaseNumber,
              fileName,
              content,
              rules,
              vectors,
              baseline,
            });
            setNextLocalCaseNumber((n) => n + 1);
          } else {
            throw err;
          }
        }
      }
      const newCase = result.caseData;
      setCases((prev) => [newCase, ...prev]);
      setRules(result.rules);
      setAutoPlayTraceId(newCase.trace_id);
      setSelectedTraceId(newCase.trace_id);
      setActiveTab('live');
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Simulation failed.');
    } finally {
      setIsSimulating(false);
    }
  };

  const handleRunPoisonedDemo = () => {
    const poisoned = scenarios.find((s) => s.id === 'hacker_resume') ?? scenarios[1];
    if (!poisoned) return;
    handleSimulate(poisoned.fileName, poisoned.content);
  };

  const handleRunCleanDemo = () => {
    const clean = scenarios.find((s) => s.kind === 'clean') ?? scenarios[0];
    if (!clean) return;
    handleSimulate(clean.fileName, clean.content);
  };

  const handleInvestigate = async (traceId: string) => {
    setIsInvestigating(true);
    setInvestigateError(null);
    const applyLocalForensics = () => {
      const target = cases.find((c) => c.trace_id === traceId);
      if (!target) {
        throw new Error(`Trace "${traceId}" was not found.`);
      }
      const res = runLocalForensicInvestigation(target, rules);
      setCases((prev) =>
        prev.map((c) => (c.trace_id === res.caseData.trace_id ? res.caseData : c))
      );
      setRules(res.rules);
    };

    try {
      if (localOnlyMode) {
        applyLocalForensics();
        return;
      }
      const data = await fetchJson<{ caseData: AgentCase; rules: SecurityRule[] }>(
        `/api/investigate/${encodeURIComponent(traceId)}`,
        {
          method: 'POST',
        }
      );
      const updatedCase = data.caseData;
      setCases((prev) =>
        prev.map((c) => (c.trace_id === updatedCase.trace_id ? updatedCase : c))
      );
      setRules(data.rules);
    } catch (err) {
      if (err instanceof ApiHtmlResponseError) {
        setLocalOnlyMode(true);
        applyLocalForensics();
      } else {
        setInvestigateError(
          err instanceof Error ? err.message : 'Unable to complete Gemini investigation.'
        );
      }
    } finally {
      setIsInvestigating(false);
    }
  };

  const handleToggleRule = async (id: string, enabled: boolean) => {
    if (localOnlyMode) {
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
      return;
    }
    try {
      const data = await fetchJson<{ rules: SecurityRule[] }>(
        `/api/rules/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        }
      );
      setRules(data.rules);
    } catch (err) {
      if (err instanceof ApiHtmlResponseError) {
        setLocalOnlyMode(true);
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
      } else {
        setBannerError(err instanceof Error ? err.message : 'Unable to update rule.');
      }
    }
  };

  const handleCreateRule = async (input: {
    name: string;
    description: string;
    severity: RuleSeverity;
    field: RuleMatchField;
    pattern: string;
    mode: 'contains' | 'regex';
  }) => {
    const createLocal = () => {
      const rule: SecurityRule = {
        id: `rule_custom_${Date.now()}`,
        name: input.name.trim(),
        description: input.description.trim() || 'Custom security detection rule.',
        severity: input.severity,
        field: input.field,
        pattern: input.pattern.trim(),
        mode: input.mode,
        enabled: true,
        source: 'Custom',
        createdAt: new Date().toISOString(),
        hits: 0,
      };
      setRules((prev) => [rule, ...prev]);
    };

    if (localOnlyMode) {
      createLocal();
      return;
    }
    try {
      const data = await fetchJson<{ rules: SecurityRule[] }>('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      setRules(data.rules);
    } catch (err) {
      if (err instanceof ApiHtmlResponseError) {
        setLocalOnlyMode(true);
        createLocal();
      } else {
        throw err;
      }
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (localOnlyMode) {
      setRules((prev) => prev.filter((r) => r.id !== id));
      return;
    }
    try {
      const data = await fetchJson<{ rules: SecurityRule[] }>(
        `/api/rules/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      setRules(data.rules);
    } catch (err) {
      if (err instanceof ApiHtmlResponseError) {
        setLocalOnlyMode(true);
        setRules((prev) => prev.filter((r) => r.id !== id));
      } else {
        setBannerError(err instanceof Error ? err.message : 'Unable to delete rule.');
      }
    }
  };

  const handleUpdateBaseline = async (patch: {
    similarityThreshold?: number;
    avgReadFileCalls?: number;
  }) => {
    const applyLocal = () => {
      setBaseline((prev) => ({
        ...prev,
        ...(typeof patch.similarityThreshold === 'number'
          ? {
              similarityThreshold: Math.max(
                50,
                Math.min(95, Math.round(patch.similarityThreshold))
              ),
            }
          : {}),
        ...(typeof patch.avgReadFileCalls === 'number'
          ? {
              avgReadFileCalls: Math.max(1, Math.min(5, Math.round(patch.avgReadFileCalls))),
            }
          : {}),
      }));
    };

    if (localOnlyMode) {
      applyLocal();
      return;
    }
    try {
      const data = await fetchJson<{ baseline: BaselineProfile }>('/api/baseline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      setBaseline(data.baseline);
    } catch (err) {
      if (err instanceof ApiHtmlResponseError) {
        setLocalOnlyMode(true);
        applyLocal();
      } else {
        setBannerError(err instanceof Error ? err.message : 'Unable to update baseline.');
      }
    }
  };

  const handleProbeVector = async (text: string): Promise<VectorMatch> => {
    if (localOnlyMode) {
      return computeVectorSimilarity(text, vectors, baseline.similarityThreshold);
    }
    try {
      const data = await fetchJson<{ match: VectorMatch }>('/api/vectors/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      return data.match;
    } catch (err) {
      if (err instanceof ApiHtmlResponseError) {
        setLocalOnlyMode(true);
        return computeVectorSimilarity(text, vectors, baseline.similarityThreshold);
      }
      throw err;
    }
  };

  const handleCreateVector = async (input: {
    label: string;
    category: string;
    samplePhrase: string;
  }) => {
    const addLocal = () => {
      const keywords = Array.from(
        new Set(
          input.samplePhrase
            .toLowerCase()
            .replace(/[^a-z0-9 ]+/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length >= 3)
        )
      ).slice(0, 10);
      const newSig: VectorSignature = {
        id: `vec_${Date.now()}`,
        label: input.label.trim(),
        category: input.category.trim() || 'Custom Injection',
        samplePhrase: input.samplePhrase.trim(),
        keywords,
        severity: 'CRITICAL',
      };
      setVectors((prev) => [newSig, ...prev]);
    };

    if (localOnlyMode) {
      addLocal();
      return;
    }
    try {
      const data = await fetchJson<{ vectors: VectorSignature[] }>('/api/vectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      setVectors(data.vectors);
    } catch (err) {
      if (err instanceof ApiHtmlResponseError) {
        setLocalOnlyMode(true);
        addLocal();
      } else {
        throw err;
      }
    }
  };

  const handleReset = async () => {
    setInvestigateError(null);
    setBannerError(null);
    setAutoPlayTraceId(null);
    const resetLocal = () => {
      const fallback = getFallbackInitialState();
      setCases(fallback.cases);
      setRules(fallback.rules);
      setVectors(fallback.vectors);
      setBaseline(fallback.baseline);
      setOpenSearchMode(fallback.openSearchMode);
      setOpenSearchIndex(fallback.openSearchIndex);
      setSelectedTraceId(fallback.cases[0]?.trace_id ?? null);
      setNextLocalCaseNumber(100);
    };

    if (localOnlyMode) {
      resetLocal();
      return;
    }
    try {
      const data = await fetchJson<ApiStateResponse>('/api/reset', { method: 'POST' });
      setCases(data.cases);
      setRules(data.rules);
      setVectors(data.vectors);
      setBaseline(data.baseline);
      setOpenSearchMode(data.openSearchMode);
      setOpenSearchIndex(data.openSearchIndex);
      setSelectedTraceId(data.cases[0]?.trace_id ?? null);
    } catch (err) {
      if (err instanceof ApiHtmlResponseError) {
        setLocalOnlyMode(true);
        resetLocal();
      } else {
        setBannerError(err instanceof Error ? err.message : 'Unable to reset demo state.');
      }
    }
  };

  const selectedCase =
    cases.find((c) => c.trace_id === selectedTraceId) ?? cases[0] ?? null;

  return (
    <div id="top" className="min-h-screen bg-black text-zinc-100">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onRunPoisonedDemo={handleRunPoisonedDemo}
        isSimulating={isSimulating}
      />

      <main className="mx-auto max-w-[1400px] space-y-6 px-4 pt-6 pb-16 sm:px-6 lg:px-8">
        {/* Page Header & Open-Source Project Toolbar */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-zinc-400">
              <span className="font-semibold text-zinc-200">agentsiem/agentsiem</span>
              <span aria-hidden="true">·</span>
              <span>Apache-2.0</span>
              <span aria-hidden="true">·</span>
              <span>OpenSearch 2.17 + FastAPI + Python SDK</span>
            </div>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-white [text-wrap:balance]">
              AI Agent Flight Recorder & Forensic Pipeline
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              Open-source SIEM for AI agents: capture every step, detect prompt injections with rules, anomaly baselines, and k-NN vector search, then investigate root causes with Gemini.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeTab !== 'sdk' && (
              <button
                type="button"
                onClick={() => setActiveTab('sdk')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 whitespace-nowrap"
              >
                <span>Browse OSS Repo (11 files)</span>
              </button>
            )}

            {activeTab === 'live' && (
              <button
                type="button"
                onClick={() => setShowGuide((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 whitespace-nowrap"
              >
                <span>{showGuide ? 'Hide 3-Step Guide' : 'Show 3-Step Guide'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
              <span>Reset Demo State</span>
            </button>
          </div>
        </div>

        {bannerError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-900/70 bg-red-950/50 px-4 py-3 text-xs font-medium text-red-200"
          >
            <span>{bannerError}</span>
            <button
              type="button"
              onClick={() => void loadState()}
              className="rounded-md border border-red-800/80 bg-black/50 px-2.5 py-1 text-xs font-semibold text-red-100 transition-colors hover:bg-red-900/40"
            >
              Retry Connection
            </button>
          </div>
        )}

        {activeTab === 'live' && showGuide && (
          <StoryBanner
            onRunClean={handleRunCleanDemo}
            onRunAttack={handleRunPoisonedDemo}
            onInvestigateActive={() => {
              if (selectedCase) {
                void handleInvestigate(selectedCase.trace_id);
              }
            }}
            isSimulating={isSimulating}
            isInvestigating={isInvestigating}
            activeTraceId={selectedCase?.trace_id ?? null}
          />
        )}

        <KpiStrip cases={cases} rules={rules} vectors={vectors} />

        {loading ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="h-80 animate-pulse rounded-xl border border-zinc-800 bg-zinc-950 lg:col-span-4" />
            <div className="h-80 animate-pulse rounded-xl border border-zinc-800 bg-zinc-950 lg:col-span-8" />
          </div>
        ) : activeTab === 'live' ? (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
            <div className="space-y-6 lg:col-span-4">
              <LiveTestBench
                scenarios={scenarios}
                onSimulate={handleSimulate}
                isSimulating={isSimulating}
              />
              <CaseListRail
                cases={cases}
                selectedTraceId={selectedCase?.trace_id ?? null}
                onSelectCase={(id) => {
                  setAutoPlayTraceId(null);
                  setSelectedTraceId(id);
                  setInvestigateError(null);
                }}
              />
            </div>

            <div className="lg:col-span-8">
              <CaseInspector
                caseData={selectedCase}
                rules={rules}
                openSearchIndex={openSearchIndex}
                autoPlayTraceId={autoPlayTraceId}
                onInvestigate={handleInvestigate}
                onRetestFile={handleSimulate}
                isInvestigating={isInvestigating}
                investigateError={investigateError}
                isSimulating={isSimulating}
              />
            </div>
          </div>
        ) : activeTab === 'traces' ? (
          <CaseTracesView
            cases={cases}
            onInspectCase={(id) => {
              setAutoPlayTraceId(null);
              setSelectedTraceId(id);
              setInvestigateError(null);
              setActiveTab('live');
            }}
          />
        ) : activeTab === 'rules' ? (
          <RulesEngineView
            rules={rules}
            onToggleRule={handleToggleRule}
            onCreateRule={handleCreateRule}
            onDeleteRule={handleDeleteRule}
          />
        ) : activeTab === 'vectors' ? (
          <VectorStoreView
            vectors={vectors}
            baseline={baseline}
            onUpdateBaseline={handleUpdateBaseline}
            onProbeVector={handleProbeVector}
            onCreateVector={handleCreateVector}
          />
        ) : (
          <OpenSearchSdkView
            openSearchMode={openSearchMode}
            openSearchIndex={openSearchIndex}
            rules={rules}
            vectors={vectors}
            baseline={baseline}
            onIngestedCase={async (ingested) => {
              if (localOnlyMode) {
                setCases((prev) =>
                  prev.some((c) => c.trace_id === ingested.trace_id)
                    ? prev
                    : [ingested, ...prev]
                );
                const hitIds = new Set(ingested.ruleHits.map((h) => h.ruleId));
                if (hitIds.size > 0) {
                  setRules((prev) =>
                    prev.map((r) => (hitIds.has(r.id) ? { ...r, hits: r.hits + 1 } : r))
                  );
                }
              } else {
                await loadState();
              }
              setSelectedTraceId(ingested.trace_id);
              setActiveTab('live');
            }}
          />
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/80 pt-5 text-xs text-zinc-500">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-zinc-300">AgentSIEM</span>
            <span aria-hidden="true">·</span>
            <span>Apache-2.0 Open-Source Project</span>
            <span aria-hidden="true">·</span>
            <span>OpenSearch 2.17 · FastAPI · Python SDK · Gemini Forensics</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('sdk')}
              className="text-zinc-400 transition-colors hover:text-zinc-100"
            >
              Source Repository
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className="text-zinc-400 transition-colors hover:text-zinc-100"
            >
              Guard Rules
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('traces')}
              className="text-zinc-400 transition-colors hover:text-zinc-100"
            >
              Case Index
            </button>
          </div>
        </footer>
      </main>

      <AiChatbot
        activeTraceId={selectedCase?.trace_id ?? null}
        activeCase={selectedCase}
        cases={cases}
        rules={rules}
        vectors={vectors}
        baseline={baseline}
        localOnlyMode={localOnlyMode}
      />
    </div>
  );
}
