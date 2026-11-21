import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { RuleMatchField, RuleSeverity, SecurityRule } from '../engine/types';

interface RulesEngineViewProps {
  rules: SecurityRule[];
  onToggleRule: (id: string, enabled: boolean) => Promise<void>;
  onCreateRule: (input: {
    name: string;
    description: string;
    severity: RuleSeverity;
    field: RuleMatchField;
    pattern: string;
    mode: 'contains' | 'regex';
  }) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
}

export const RulesEngineView: React.FC<RulesEngineViewProps> = ({
  rules,
  onToggleRule,
  onCreateRule,
  onDeleteRule,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('');
  const [description, setDescription] = useState('');
  const [field, setField] = useState<RuleMatchField>('content');
  const [mode, setMode] = useState<'contains' | 'regex'>('contains');
  const [severity, setSeverity] = useState<RuleSeverity>('CRITICAL');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !pattern.trim()) {
      setError('Both Rule Name and Match Pattern are required.');
      return;
    }
    if (mode === 'regex') {
      try {
        new RegExp(pattern.trim(), 'i');
      } catch {
        setError('Invalid regular expression syntax in Match Pattern.');
        return;
      }
    }
    setError('');
    setSaving(true);
    try {
      await onCreateRule({
        name: name.trim(),
        description: description.trim(),
        severity,
        field,
        pattern: pattern.trim(),
        mode,
      });
      setName('');
      setPattern('');
      setDescription('');
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rule.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="rules-heading"
        className="rounded-xl border border-zinc-800 bg-zinc-950"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 id="rules-heading" className="font-display text-base font-semibold text-white">
              OpenSearch Security Rules Engine
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Active baseline guardrails and Gemini Auto-Protection rules evaluated on every Flight Recorder event.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-black transition-colors hover:bg-white whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{showForm ? 'Close Form' : 'New Security Rule'}</span>
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="border-b border-zinc-800 bg-black/60 p-6"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="rule-name" className="block text-xs font-medium text-zinc-300">
                  Rule Name
                </label>
                <input
                  id="rule-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Block System Override"
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="rule-pattern" className="block text-xs font-medium text-zinc-300">
                  Match Pattern
                </label>
                <input
                  id="rule-pattern"
                  type="text"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder="system override"
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="rule-field" className="block text-xs font-medium text-zinc-300">
                  Inspect Field
                </label>
                <select
                  id="rule-field"
                  value={field}
                  onChange={(e) => setField(e.target.value as RuleMatchField)}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="content">content (Step 1 Input & Thoughts)</option>
                  <option value="target">target (File / URL Target)</option>
                  <option value="tool_name">tool_name (Tool Name)</option>
                  <option value="any">any (All Fields)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="rule-mode" className="block text-xs font-medium text-zinc-300">
                    Mode
                  </label>
                  <select
                    id="rule-mode"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as 'contains' | 'regex')}
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-black px-2.5 py-2 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="contains">Contains</option>
                    <option value="regex">Regex</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="rule-sev" className="block text-xs font-medium text-zinc-300">
                    Severity
                  </label>
                  <select
                    id="rule-sev"
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as RuleSeverity)}
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-black px-2.5 py-2 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="CRITICAL">Critical</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-[260px] flex-1">
                <label htmlFor="rule-desc" className="block text-xs font-medium text-zinc-300">
                  Description (Optional)
                </label>
                <input
                  id="rule-desc"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Quarantine documents containing override instructions."
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
              >
                {saving ? 'Saving Rule...' : 'Save Rule to Engine'}
              </button>
            </div>

            {error && (
              <p role="alert" className="mt-2 text-xs font-medium text-red-400">
                {error}
              </p>
            )}
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-black/60 text-zinc-400">
                <th className="px-6 py-3 font-semibold">Rule</th>
                <th className="px-4 py-3 font-semibold">Source</th>
                <th className="px-4 py-3 font-semibold">Field · Mode</th>
                <th className="px-4 py-3 font-semibold">Pattern</th>
                <th className="px-4 py-3 font-semibold text-right">Hits</th>
                <th className="px-4 py-3 font-semibold">State</th>
                <th className="px-6 py-3 font-semibold text-right">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-zinc-900/50">
                  <td className="px-6 py-3.5 max-w-[300px]">
                    <div className="font-semibold text-zinc-100">{rule.name}</div>
                    <div className="mt-0.5 text-zinc-400 line-clamp-2">
                      {rule.description}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <span
                      className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${
                        rule.source === 'Gemini Auto-Rule'
                          ? 'border-blue-900/80 bg-blue-950/60 text-blue-300'
                          : rule.source === 'Custom'
                            ? 'border-amber-900/80 bg-amber-950/60 text-amber-300'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-300'
                      }`}
                    >
                      {rule.source}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-zinc-300 whitespace-nowrap">
                    {rule.field} · {rule.mode}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-zinc-100 max-w-[220px] truncate">
                    {rule.pattern}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-zinc-100 tabular-nums">
                    {rule.hits}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.enabled}
                      aria-label={`Toggle rule ${rule.name}`}
                      onClick={() => onToggleRule(rule.id, !rule.enabled)}
                      className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        rule.enabled
                          ? 'border-emerald-900/80 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-950'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                      }`}
                    >
                      {rule.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-6 py-3.5 text-right whitespace-nowrap">
                    {rule.source !== 'Baseline' ? (
                      <button
                        type="button"
                        onClick={() => onDeleteRule(rule.id)}
                        aria-label={`Delete rule ${rule.name}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    ) : (
                      <span className="text-[11px] text-zinc-500">Protected</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
