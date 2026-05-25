'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  AIFunctionId,
  ModelTier,
  FunctionSettingRow,
} from '@/lib/ai/function-settings';

interface Props {
  slug: string;
  initialSettings: FunctionSettingRow[];
  tierToModel: Record<Exclude<ModelTier, 'custom'>, string>;
  defaults: Record<AIFunctionId, Exclude<ModelTier, 'custom'>>;
  labels: Record<AIFunctionId, string>;
  descriptions: Record<AIFunctionId, string>;
  functionIds: AIFunctionId[];
}

export function SettingsClient({
  slug,
  initialSettings,
  tierToModel,
  defaults,
  labels,
  descriptions,
  functionIds,
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

  function resolveModel(tier: ModelTier, customModel: string | null): string {
    if (tier === 'custom' && customModel && customModel.trim()) return customModel.trim();
    if (tier === 'light' || tier === 'default' || tier === 'heavy') return tierToModel[tier];
    return tierToModel.default;
  }

  function findSetting(functionId: AIFunctionId): FunctionSettingRow {
    return settings.find(s => s.functionId === functionId)!;
  }

  async function setTier(functionId: AIFunctionId, tier: ModelTier, customModel: string | null = null) {
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
      setSettings(prev => prev.map(s => s.functionId === functionId
        ? { ...s, tier, customModel: tier === 'custom' ? customModel : null, resolvedModel: resolveModel(tier, customModel) }
        : s
      ));
      setMessage({ kind: 'ok', text: `${labels[functionId]} → ${resolveModel(tier, customModel)}` });
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
      const defaultTier = defaults[functionId];
      setSettings(prev => prev.map(s => s.functionId === functionId
        ? { ...s, tier: defaultTier, customModel: null, resolvedModel: tierToModel[defaultTier] }
        : s
      ));
      setMessage({ kind: 'ok', text: `${labels[functionId]} → default (${tierToModel[defaultTier]})` });
    } finally {
      setBusy(null);
    }
  }

  const modelAvailable = (id: string) => availableModels.length === 0 || availableModels.includes(id);

  return (
    <div className="space-y-6">
      <section className="rounded-md border bg-card px-4 py-3 text-xs leading-snug text-muted-foreground">
        <p className="font-medium text-foreground">How tiers work</p>
        <p className="mt-1">
          Each AI function in the system can use a different model. Tiers are an indirection: when a new generation of models ships, swapping the tier-to-model map updates every function using that tier. You can also pick a specific model from the dropdown for a function that needs a different one.
        </p>
        <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
          <li>Light  → <span className="text-foreground">{tierToModel.light}</span>
            {!modelAvailable(tierToModel.light) && <span className="ml-2 text-destructive">(not in available list)</span>}
            <span className="ml-2 text-muted-foreground">(cheap, fast)</span>
          </li>
          <li>Default → <span className="text-foreground">{tierToModel.default}</span>
            {!modelAvailable(tierToModel.default) && <span className="ml-2 text-destructive">(not in available list)</span>}
            <span className="ml-2 text-muted-foreground">(balanced)</span>
          </li>
          <li>Heavy  → <span className="text-foreground">{tierToModel.heavy}</span>
            {!modelAvailable(tierToModel.heavy) && <span className="ml-2 text-destructive">(not in available list)</span>}
            <span className="ml-2 text-muted-foreground">(more reasoning, higher cost)</span>
          </li>
        </ul>
        {availableModels.length > 0 && (
          <p className="mt-2 text-[10px]">
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

      <section className="space-y-3">
        {functionIds.map(functionId => {
          const s = findSetting(functionId);
          const isModified = s.tier !== defaults[functionId];
          const isBusy = busy === functionId;
          return (
            <div key={functionId} className="rounded-md border bg-card px-4 py-3 space-y-2">
              <header>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold">{labels[functionId]}</h3>
                  <span className="font-mono text-[11px] text-muted-foreground">{s.resolvedModel}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{descriptions[functionId]}</p>
              </header>

              <div className="flex items-center gap-2 flex-wrap">
                <TierButton tier="light" current={s.tier} disabled={isBusy} onClick={() => setTier(functionId, 'light')} />
                <TierButton tier="default" current={s.tier} disabled={isBusy} onClick={() => setTier(functionId, 'default')} />
                <TierButton tier="heavy" current={s.tier} disabled={isBusy} onClick={() => setTier(functionId, 'heavy')} />

                <ModelDropdown
                  isCustom={s.tier === 'custom'}
                  currentValue={s.customModel ?? ''}
                  availableModels={availableModels}
                  disabled={isBusy}
                  onSet={(value) => setTier(functionId, 'custom', value)}
                />

                {isModified && (
                  <button
                    type="button"
                    onClick={() => resetToDefault(functionId)}
                    disabled={isBusy}
                    className="ml-auto text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    reset to default ({defaults[functionId]})
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function TierButton({
  tier,
  current,
  disabled,
  onClick,
}: {
  tier: 'light' | 'default' | 'heavy';
  current: ModelTier;
  disabled: boolean;
  onClick: () => void;
}) {
  const active = current === tier;
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
      {tier}
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
      <span className="text-[11px] italic text-muted-foreground">
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
