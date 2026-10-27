'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  AIFunctionId,
  StoredTier,
  FunctionSettingRow,
} from '@/lib/ai/function-settings';
import { DEFAULT_REASONING_EFFORT, MODEL_ROLES, type ModelRole, type RoleSetting } from '@/lib/ai/models';

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
  /** F1 (owner decision, 2026-10-07): changing AI model settings is
   *  admin-only — the server already enforces this (PUT/DELETE
   *  /api/settings/ai-models are admin-kind in lib/auth/authorize.ts
   *  classify()). A non-admin viewer sees everything read-only with a
   *  note, instead of a save/reset click 403ing in front of them. */
  isAdmin: boolean;
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
    pct >= 90 ? 'text-destructive'
    : pct >= 60 ? 'text-amber-700'
    : 'text-foreground';
  const barTone =
    pct >= 90 ? 'bg-destructive'
    : pct >= 60 ? 'bg-amber-500'
    : 'bg-emerald-500';
  // Find max for sparkline scaling — use the bigger of (history max, cap).
  const histMax = Math.max(0, ...history.map(d => d.spentCents));
  const sparkMax = Math.max(histMax, capCents);

  return (
    <section className="rounded-md border bg-card px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Today&apos;s AI cost</p>
          <p className={`mt-0.5 text-2xl font-semibold ${tone}`}>
            {dollars(today.spentCents)} <span className="text-sm font-normal text-muted-foreground">of {dollars(capCents)} cap</span>
          </p>
        </div>
        <p className="text-xs text-muted-foreground">UTC day · resets at 00:00 UTC</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded bg-muted">
        <div
          className={`h-full ${barTone} transition-all`}
          style={{ width: `${pct}%` }}
          aria-label={`${pct.toFixed(0)}% of cap used`}
        />
      </div>

      {history.length > 1 && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last {history.length} days</p>
          <div className="mt-2 flex items-end gap-1 h-16">
            {history.map((d, i) => {
              const heightPct = sparkMax > 0 ? (d.spentCents / sparkMax) * 100 : 0;
              const isToday = i === history.length - 1;
              const overCap = d.spentCents > capCents;
              return (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <div className="relative w-full h-12 flex items-end">
                    <div
                      className={
                        'w-full rounded-sm ' +
                        (overCap ? 'bg-destructive' : isToday ? 'bg-emerald-600' : 'bg-emerald-300')
                      }
                      style={{ height: `${Math.max(2, heightPct)}%` }}
                      title={`${d.day} — ${dollars(d.spentCents)}`}
                    />
                  </div>
                  <span className={`text-xs ${isToday ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                    {d.day.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
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
}: Props) {
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

  function resolve(functionId: AIFunctionId, tier: StoredTier, customModel: string | null): { model: string; effort: string | undefined } {
    if (tier === 'custom' && customModel && customModel.trim()) {
      const model = customModel.trim();
      return { model, effort: DEFAULT_REASONING_EFFORT[model] };
    }
    const role = tier === 'custom' ? defaults[functionId] : tier;
    return { model: roles[role].model, effort: roles[role].effort };
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
        ? { ...s, tier, customModel: tier === 'custom' ? customModel : null, resolvedModel: r.model, resolvedEffort: r.effort }
        : s
      ));
      setMessage({ kind: 'ok', text: `${labels[functionId]} → ${describeModel(r)}` });
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
      const r = resolve(functionId, defaultRole, null);
      setSettings(prev => prev.map(s => s.functionId === functionId
        ? { ...s, tier: defaultRole, customModel: null, resolvedModel: r.model, resolvedEffort: r.effort }
        : s
      ));
      setMessage({ kind: 'ok', text: `${labels[functionId]} → ${roles[defaultRole].label} (${describeModel(r)})` });
    } finally {
      setBusy(null);
    }
  }

  const modelAvailable = (id: string) => availableModels.length === 0 || availableModels.includes(id);

  return (
    <div className="space-y-6">
      <DailyCostPanel history={costHistory} capCents={capCents} />

      {!isAdmin && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          Only an admin can change AI model settings. Shown read-only below.
        </p>
      )}

      <section className="rounded-md border bg-card px-4 py-3 text-xs leading-snug text-muted-foreground">
        <p className="font-medium text-foreground">How roles work</p>
        <p className="mt-1">
          Each AI function has a role that says what kind of work it does. A role sets the model and reasoning effort for every function in it; roles are changed in the code (<span className="font-mono">lib/ai/models.ts</span>), not here. Here you can move a function to another role or pin it to a specific model.
        </p>
        <ul className="mt-2 space-y-0.5">
          {MODEL_ROLES.map(role => (
            <li key={role}>
              <span className="font-medium text-foreground">{roles[role].label}</span>
              <span className="ml-2">{roles[role].purpose}</span>
              <span className="ml-2 font-mono text-foreground">→ {describeModel(roles[role])}</span>
              {!modelAvailable(roles[role].model) && <span className="ml-2 text-destructive">(not in available list)</span>}
            </li>
          ))}
        </ul>
        {availableModels.length > 0 && (
          <p className="mt-2 text-xs">
            {availableModels.length} chat-capable model{availableModels.length === 1 ? '' : 's'} available from this API key{modelsStale && ' (cached — could not refresh)'}.
          </p>
        )}
        {modelsError && <p className="mt-2 text-destructive">{modelsError}</p>}
      </section>

      {message && (
        <p className={'rounded border px-3 py-2 text-xs ' + (message.kind === 'ok'
          ? 'border-green-300 bg-green-50 text-green-800'
          : 'border-destructive/30 bg-red-50 text-destructive')}>
          {message.text}
        </p>
      )}

      {[...MODEL_ROLES, 'custom' as const].map(group => {
        const members = functionIds.filter(id => findSetting(id).tier === group);
        if (group === 'custom' && members.length === 0) return null;
        const headingId = `role-${group}`;
        return (
          <section key={group} aria-labelledby={headingId} className="space-y-3">
            <header>
              <h2 id={headingId} className="text-sm font-semibold">{group === 'custom' ? 'Custom model' : roles[group].label}</h2>
              <p className="text-xs text-muted-foreground">
                {group === 'custom' ? 'Functions pinned to a specific model.' : `${roles[group].purpose} · ${describeModel(roles[group])}`}
              </p>
            </header>
            {members.length === 0 && <p className="text-xs italic text-muted-foreground">No functions.</p>}
            {members.map(functionId => renderFunction(functionId))}
          </section>
        );
      })}
    </div>
  );

  function renderFunction(functionId: AIFunctionId) {
    const s = findSetting(functionId);
    const isModified = s.tier !== defaults[functionId];
    const isBusy = busy === functionId;
    return (
      <div key={functionId} className="rounded-md border bg-card px-4 py-3 space-y-2">
        <header>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold">{labels[functionId]}</h3>
            <span className="font-mono text-xs text-muted-foreground">{describeModel({ model: s.resolvedModel, effort: s.resolvedEffort })}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{descriptions[functionId]}</p>
        </header>

        <div className="flex items-center gap-2 flex-wrap">
          {MODEL_ROLES.map(role => (
            <RoleButton key={role} label={roles[role].label} active={s.tier === role} disabled={isBusy || !isAdmin} onClick={() => setTier(functionId, role)} />
          ))}

          <ModelDropdown
            isCustom={s.tier === 'custom'}
            currentValue={s.customModel ?? ''}
            availableModels={availableModels}
            disabled={isBusy || !isAdmin}
            onSet={(value) => setTier(functionId, 'custom', value)}
          />

          {isModified && isAdmin && (
            <button
              type="button"
              onClick={() => resetToDefault(functionId)}
              disabled={isBusy}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
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
function describeModel({ model, effort }: { model: string; effort: string | undefined }): string {
  return effort ? `${model} · ${effort} effort` : model;
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
      className={
        'rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 '
        + (active
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground')
      }
    >
      {label}
    </button>
  );
}

function ModelDropdown({
  isCustom,
  currentValue,
  availableModels,
  disabled,
  onSet,
}: {
  isCustom: boolean;
  currentValue: string;
  availableModels: string[];
  disabled: boolean;
  onSet: (model: string) => void;
}) {
  // When the list hasn't loaded yet (or failed), fall back to a disabled
  // placeholder so the UI doesn't render an empty unusable dropdown.
  if (availableModels.length === 0) {
    return (
      <span className="text-xs italic text-muted-foreground">
        (loading models…)
      </span>
    );
  }

  // Show the current custom model in the dropdown even if it's somehow no
  // longer in the available list — so users can see what they picked.
  const optionList = isCustom && currentValue && !availableModels.includes(currentValue)
    ? [currentValue, ...availableModels]
    : availableModels;

  return (
    <select
      value={isCustom ? currentValue : ''}
      onChange={e => {
        const v = e.target.value;
        if (v) onSet(v);
      }}
      disabled={disabled}
      className={
        'rounded border border-input bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 '
        + (isCustom ? 'border-primary' : '')
      }
    >
      <option value="">pick specific model…</option>
      {optionList.map(m => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
  );
}
