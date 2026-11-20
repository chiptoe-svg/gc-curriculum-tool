'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  AIFunctionId,
  StoredTier,
  FunctionSettingRow,
} from '@/lib/ai/function-settings';
import { DEFAULT_REASONING_EFFORT, MODEL_ROLES, isCampusModel, type ModelRole, type RoleProvider, type RoleSetting } from '@/lib/ai/models';
import { pickerGroups } from '@/lib/ai/model-catalog';
import { evidenceFor, evidenceForKey, type Evidence } from '@/lib/settings/evidence-lookup';

export interface SearchState {
  rerank: { override: 'on' | 'off' | null; effective: boolean; model: string };
  embedding: { model: string };
}

interface Props {
  slug: string;
  initialSettings: FunctionSettingRow[];
  roles: Record<ModelRole, RoleSetting>;
  defaults: Record<AIFunctionId, ModelRole>;
  labels: Record<AIFunctionId, string>;
  descriptions: Record<AIFunctionId, string>;
  functionIds: AIFunctionId[];
  /** Last N days of daily spend, ASC by day. Today is the last entry. */
  costHistory: Array<{ day: string; spentCents: number }>;
  /** Daily cap in 1/100-of-a-cent units (matches spentCents unit). */
  capCents: number;
  /** Code-default campus routes (FUNCTION_PROVIDER_DEFAULTS), so Reset shows what the function returns to. */
  routes?: Partial<Record<AIFunctionId, { provider: 'campus'; model: string; reasoning: string }>>;
  /** F1 (owner decision, 2026-10-07): changing AI model settings is
   *  admin-only — the server already enforces this (PUT/DELETE
   *  /api/settings/ai-models are admin-kind in lib/auth/authorize.ts
   *  classify()). A non-admin viewer sees everything read-only with a
   *  note, instead of a save/reset click 403ing in front of them. */
  isAdmin: boolean;
  /** The evidence register (docs/benchmarks), without page bodies. */
  evidence?: Evidence[];
  /** Reranker and embedding settings; null when they could not be read. */
  search?: SearchState | null;
}

/**
 * Convert the internal 1/100-of-a-cent unit to a dollar string.
 * `recordSpend` and `spentCents` both use this unit despite the misleading
 * name; division by 10000 yields dollars. See lib/rate-limit/daily-cap.ts.
 */
function dollars(units: number): string {
  return `$${(units / 10000).toFixed(2)}`;
}

function DailyCostPanel({
  history,
  capCents,
}: {
  history: Array<{ day: string; spentCents: number }>;
  capCents: number;
}) {
  const today = history.at(-1) ?? { day: '', spentCents: 0 };
  const pct = capCents > 0 ? Math.min(100, (today.spentCents / capCents) * 100) : 0;
  const tone =
    pct >= 90 ? 'st-tone-issue'
    : pct >= 60 ? 'st-tone-input'
    : 'st-tone-done';
  const barTone =
    pct >= 90 ? 'st-fill-issue'
    : pct >= 60 ? 'st-fill-input'
    : 'st-fill-done';
  // Find max for sparkline scaling — use the bigger of (history max, cap).
  const histMax = Math.max(0, ...history.map(d => d.spentCents));
  const sparkMax = Math.max(histMax, capCents);

  return (
    <section className="rounded-md st-card">
      <div className="st-card-row">
        <div>
          <p className="st-label">Today&apos;s AI cost</p>
          <p className={`st-big ${tone}`}>
            {dollars(today.spentCents)} <span className="st-meta">of {dollars(capCents)} cap</span>
          </p>
        </div>
        <p className="st-meta">UTC day · resets at 00:00 UTC</p>
      </div>
      <div className="st-meter">
        <div
          className={barTone}
          style={{ width: `${pct}%` }}
          aria-label={`${pct.toFixed(0)}% of cap used`}
        />
      </div>

      {history.length > 1 && (
        <div className="mt-2">
          <p className="st-label">Last {history.length} days</p>
          <div className="st-spark">
            {history.map((d, i) => {
              const heightPct = sparkMax > 0 ? (d.spentCents / sparkMax) * 100 : 0;
              const isToday = i === history.length - 1;
              const overCap = d.spentCents > capCents;
              return (
                <div key={d.day} className="st-spark-col">
                  <div className="st-spark-bar">
                    <div
                      className={overCap ? 'st-bar-over' : isToday ? 'st-bar-today' : 'st-bar-past'}
                      style={{ height: `${Math.max(2, heightPct)}%` }}
                      title={`${d.day} — ${dollars(d.spentCents)}`}
                    />
                  </div>
                  <span className={`st-spark-day${isToday ? ' is-today' : ''}`}>
                    {d.day.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="st-meta mt-2">
            Hover any bar for the exact figure. Bars exceeding the daily cap show in red. Today is highlighted.
          </p>
        </div>
      )}
    </section>
  );
}

export function SettingsClient({
  slug,
  initialSettings,
  roles,
  defaults,
  labels,
  descriptions,
  functionIds,
  costHistory,
  capCents,
  isAdmin,
  routes,
  evidence = [],
  search: initialSearch = null,
}: Props) {
  const [showAllModels, setShowAllModels] = useState(false);
  const [search, setSearch] = useState<SearchState | null>(initialSearch);
  const [searchBusy, setSearchBusy] = useState(false);
  const [settings, setSettings] = useState<FunctionSettingRow[]>(initialSettings);
  const [busy, setBusy] = useState<AIFunctionId | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsStale, setModelsStale] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const loadAvailableModels = useCallback(async () => {
    try {
      const res = await fetch(`/api/settings/available-models?slug=${encodeURIComponent(slug)}`);
      const json = await res.json();
      if (!res.ok) {
        setModelsError((json as { error?: string }).error ?? 'Failed to load available models');
        return;
      }
      const { models, stale } = json as { models: string[]; stale: boolean };
      setAvailableModels(models);
      setModelsStale(stale);
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Failed to load available models');
    }
  }, [slug]);

  useEffect(() => { void loadAvailableModels(); }, [loadAvailableModels]);

  function resolve(functionId: AIFunctionId, tier: StoredTier, customModel: string | null): ModelView {
    if (tier === 'custom' && customModel && customModel.trim()) {
      const model = customModel.trim();
      return { model, effort: DEFAULT_REASONING_EFFORT[model], provider: isCampusModel(model) ? 'campus' : 'openai', fallback: null };
    }
    const role = tier === 'custom' ? defaults[functionId] : tier;
    return { model: roles[role].model, effort: roles[role].effort, provider: roles[role].provider, fallback: null };
  }

  function findSetting(functionId: AIFunctionId): FunctionSettingRow {
    return settings.find(s => s.functionId === functionId)!;
  }

  async function setTier(functionId: AIFunctionId, tier: StoredTier, customModel: string | null = null) {
    setBusy(functionId);
    setMessage(null);
    try {
      const res = await fetch(`/api/settings/ai-models?slug=${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ functionId, tier, customModel }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ kind: 'error', text: (json as { error?: string }).error ?? 'Save failed' });
        return;
      }
      const r = resolve(functionId, tier, customModel);
      setSettings(prev => prev.map(s => s.functionId === functionId
        ? { ...s, tier, customModel: tier === 'custom' ? customModel : null, resolvedModel: r.model, resolvedEffort: r.effort, resolvedProvider: r.provider, resolvedFallback: r.fallback ?? null, hasOverride: true }
        : s
      ));
      setMessage({ kind: 'ok', text: `${labels[functionId]} → ${describeModel(r)}` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setBusy(null);
    }
  }

  async function setLoop(functionId: AIFunctionId, loop: 'current' | 'pi') {
    setBusy(functionId);
    setMessage(null);
    try {
      const res = await fetch(`/api/settings/ai-models?slug=${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ functionId, loop }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMessage({ kind: 'error', text: (body as { error?: string }).error ?? 'Save failed' });
        return;
      }
      setSettings(prev => prev.map(s => s.functionId === functionId ? { ...s, loop } : s));
      setMessage({ kind: 'ok', text: `${labels[functionId]} → ${loop === 'pi' ? 'Pi loop' : 'current loop'}` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setBusy(null);
    }
  }

  async function resetToDefault(functionId: AIFunctionId) {
    setBusy(functionId);
    setMessage(null);
    try {
      const res = await fetch(`/api/settings/ai-models?slug=${encodeURIComponent(slug)}&functionId=${encodeURIComponent(functionId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMessage({ kind: 'error', text: (body as { error?: string }).error ?? 'Reset failed' });
        return;
      }
      const defaultRole = defaults[functionId];
      const route = routes?.[functionId];
      const r: ModelView = route
        ? { model: route.model, effort: route.reasoning, provider: 'campus', fallback: roles[defaultRole].model }
        : resolve(functionId, defaultRole, null);
      setSettings(prev => prev.map(s => s.functionId === functionId
        ? { ...s, tier: defaultRole, customModel: null, resolvedModel: r.model, resolvedEffort: r.effort, resolvedProvider: r.provider, resolvedFallback: r.fallback ?? null, hasOverride: false }
        : s
      ));
      setMessage({ kind: 'ok', text: `${labels[functionId]} → ${roles[defaultRole].label} (${describeModel(r)})` });
    } finally {
      setBusy(null);
    }
  }

  async function setRerank(value: 'on' | 'off' | null) {
    setSearchBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/settings/search?slug=${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rerank: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind: 'error', text: (json as { error?: string }).error ?? 'Save failed' });
        return;
      }
      setSearch(json as SearchState);
      setMessage({ kind: 'ok', text: `Reranking → ${value === null ? 'server default' : value}` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSearchBusy(false);
    }
  }

  const modelAvailable = (id: string) => availableModels.length === 0 || availableModels.includes(id);

  return (
    <div className="st-stack">
      <DailyCostPanel history={costHistory} capCents={capCents} />

      {!isAdmin && (
        <p className="st-cue st-cue-input">
          Only an admin can change AI model settings. Shown read-only below.
        </p>
      )}

      <section className="rounded-md st-card st-meta">
        <h2 className="st-h3">How roles work</h2>
        <p>
          Each AI function has a role that says what kind of work it does. A role sets the model and reasoning effort for every function in it; roles are changed in the code (<span className="font-mono">lib/ai/models.ts</span>), not here. Here you can move a function to another role or pin it to a specific model.
        </p>
        <ul className="st-roles">
          {MODEL_ROLES.map(role => (
            <li key={role}>
              <strong>{roles[role].label}</strong>
              <span className="ml-2">{roles[role].purpose}</span>
              <span className="ml-2 st-mono">→ {describeModel(roles[role])}</span>
              {!modelAvailable(roles[role].model) && <span className="ml-2 st-err">(not in available list)</span>}
            </li>
          ))}
        </ul>
        <p>
          The model lists offer the models in use or tested here, plus the four campus models (free). The newest
          OpenAI models are listed as not tested here.
        </p>
        <label className="st-check">
          <input type="checkbox" checked={showAllModels} onChange={e => setShowAllModels(e.target.checked)} />
          Show every model the gateway offers
          {availableModels.length > 0 && <span>({availableModels.length}{modelsStale && ', cached'}; most are older models nobody has tested on our prompts)</span>}
        </label>
        {modelsError && <p className="st-err">{modelsError}</p>}
      </section>

      {message && (
        <p role="status" className={'st-cue ' + (message.kind === 'ok' ? 'st-cue-done' : 'st-cue-issue')}>
          {message.text}
        </p>
      )}

      {[...MODEL_ROLES, 'custom' as const].map(group => {
        const members = functionIds.filter(id => findSetting(id).tier === group);
        if (group === 'custom' && members.length === 0) return null;
        const headingId = `role-${group}`;
        return (
          <section key={group} aria-labelledby={headingId} className="st-group">
            <header>
              <h2 id={headingId} className="st-h2">{group === 'custom' ? 'Custom model' : roles[group].label}</h2>
              <p className="st-meta">
                {group === 'custom' ? 'Functions pinned to a specific model.' : `${roles[group].purpose} · ${describeModel(roles[group])}`}
              </p>
              {group !== 'custom' && <Basis evidence={evidenceForKey(evidence, `role:${group}`)} slug={slug} prefix="Role default" />}
            </header>
            {members.length === 0 && <p className="st-meta italic">No functions.</p>}
            {members.map(functionId => renderFunction(functionId))}
          </section>
        );
      })}

      <SearchSection search={search} evidence={evidence} slug={slug} isAdmin={isAdmin} busy={searchBusy} onSet={setRerank} />
    </div>
  );

  function renderFunction(functionId: AIFunctionId) {
    const s = findSetting(functionId);
    // A row naming the default role still overrides a code-default campus route, so Reset shows for any row.
    const isModified = s.hasOverride || s.tier !== defaults[functionId];
    const isBusy = busy === functionId;
    return (
      <div key={functionId} className="rounded-md st-card">
        <header>
          <div className="st-card-row">
            <h3 className="st-h3">{labels[functionId]}</h3>
            <span className="st-mono">{describeModel({ model: s.resolvedModel, effort: s.resolvedEffort, provider: s.resolvedProvider, fallback: s.resolvedFallback })}</span>
          </div>
          <p className="st-meta">{descriptions[functionId]}</p>
          <Basis
            evidence={evidenceFor(evidence, functionId, s.tier === 'custom' ? defaults[functionId] : s.tier, s.tier === 'custom' || (!!routes?.[functionId] && !s.hasOverride))}
            slug={slug}
          />
        </header>

        <div className="st-controls">
          <div className="st-seg">
            {MODEL_ROLES.map(role => (
              <RoleButton key={role} label={roles[role].label} active={s.tier === role} disabled={isBusy || !isAdmin} onClick={() => setTier(functionId, role)} />
            ))}
          </div>

          <ModelDropdown
            isCustom={s.tier === 'custom'}
            currentValue={s.customModel ?? ''}
            availableModels={availableModels}
            showAll={showAllModels}
            disabled={isBusy || !isAdmin}
            onSet={(value) => setTier(functionId, 'custom', value)}
          />

          {functionId === 'capture-chat-agent' && (
            <label className="st-field">
              Interview loop
              <select
                className="st-select"
                value={s.loop === 'pi' ? 'pi' : 'current'}
                disabled={isBusy || !isAdmin}
                onChange={e => setLoop(functionId, e.target.value as 'current' | 'pi')}
              >
                <option value="current">Current</option>
                <option value="pi">Pi</option>
              </select>
            </label>
          )}

          {isModified && isAdmin && (
            <button
              type="button"
              onClick={() => resetToDefault(functionId)}
              disabled={isBusy}
              className="st-link ml-auto"
            >
              reset to default ({roles[defaults[functionId]].label})
            </button>
          )}
        </div>
      </div>
    );
  }
}

/** "gpt-6.1-sol · low effort", or just the model when no effort is set. */
interface ModelView { model: string; effort: string | undefined; provider: RoleProvider; fallback?: string | null }

function describeModel({ model, effort, provider, fallback }: ModelView): string {
  if (provider === 'campus') {
    const level = effort === 'off' ? 'thinking off' : effort ? `thinking ${effort}` : null;
    return ['campus', model, level, fallback ? `OpenAI ${fallback} if campus fails` : null].filter(Boolean).join(' · ');
  }
  return ['OpenAI', model, effort ? `${effort} effort` : null].filter(Boolean).join(' · ');
}

function RoleButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function ModelDropdown({
  isCustom,
  currentValue,
  availableModels,
  showAll,
  disabled,
  onSet,
}: {
  isCustom: boolean;
  currentValue: string;
  availableModels: string[];
  showAll: boolean;
  disabled: boolean;
  onSet: (model: string) => void;
}) {
  const groups = pickerGroups(availableModels, showAll, isCustom && currentValue ? currentValue : null);
  return (
    <select
      value={isCustom ? currentValue : ''}
      onChange={e => {
        const v = e.target.value;
        if (v) onSet(v);
      }}
      disabled={disabled}
      className={'st-select' + (isCustom ? ' is-active' : '')}
    >
      <option value="">pick specific model…</option>
      {groups.map(g => (
        <optgroup key={g.label} label={g.label}>
          {g.models.map(m => <option key={m.id} value={m.id}>{m.text}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** "Basis: <summary> (<date>) · benchmark →", or a plain note that nothing was benchmarked. */
function Basis({ evidence, slug, prefix }: { evidence: Evidence | null; slug: string; prefix?: string }) {
  if (!evidence) {
    return <p className="st-meta italic">{prefix ? `${prefix}: not` : 'Not'} benchmarked for this function.</p>;
  }
  return (
    <p className="st-meta">
      <strong>{prefix ? `${prefix} basis` : 'Basis'}:</strong> {evidence.summary}{' '}
      <span className="whitespace-nowrap">({evidence.date}) · <a href={`/settings/benchmarks/${evidence.id}?slug=${encodeURIComponent(slug)}`}>benchmark →</a></span>
    </p>
  );
}

function SearchSection({ search, evidence, slug, isAdmin, busy, onSet }: {
  search: SearchState | null;
  evidence: Evidence[];
  slug: string;
  isAdmin: boolean;
  busy: boolean;
  onSet: (v: 'on' | 'off' | null) => void;
}) {
  return (
    <section aria-labelledby="search-settings" className="st-group">
      <header>
        <h2 id="search-settings" className="st-h2">Search</h2>
        <p className="st-meta">How the interviewer finds passages in a course's materials (campus models, no cost).</p>
      </header>
      {!search ? (
        <p className="st-err">Search settings could not be read.</p>
      ) : (
        <>
          <div className="rounded-md st-card">
            <div className="st-card-row">
              <h3 className="st-h3">Reranking</h3>
              <span className="st-mono">campus · {search.rerank.model} · {search.rerank.effective ? 'on' : 'off'}</span>
            </div>
            <p className="st-meta">Re-orders the 50 best search matches so the most relevant passage comes first. Off returns the plain search order.</p>
            <Basis evidence={evidenceForKey(evidence, 'search:rerank')} slug={slug} />
            <div className="st-seg">
              <RoleButton label="On" active={search.rerank.override === 'on'} disabled={busy || !isAdmin} onClick={() => onSet('on')} />
              <RoleButton label="Off" active={search.rerank.override === 'off'} disabled={busy || !isAdmin} onClick={() => onSet('off')} />
              <RoleButton label="Server default" active={search.rerank.override === null} disabled={busy || !isAdmin} onClick={() => onSet(null)} />
            </div>
          </div>
          <div className="rounded-md st-card">
            <div className="st-card-row">
              <h3 className="st-h3">Embedding model</h3>
              <span className="st-mono">campus · {search.embedding.model}</span>
            </div>
            <p className="st-meta">Turns passages and questions into vectors for search. Shown only: changing it means re-embedding every course's materials.</p>
            <Basis evidence={evidenceForKey(evidence, 'search:embedding')} slug={slug} />
          </div>
        </>
      )}
    </section>
  );
}
