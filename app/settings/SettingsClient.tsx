'use client';

import { useState } from 'react';
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

  return (
    <div className="space-y-6">
      <section className="rounded-md border bg-card px-4 py-3 text-xs leading-snug text-muted-foreground">
        <p className="font-medium text-foreground">How tiers work</p>
        <p className="mt-1">
          Each AI function in the system can use a different model. Tiers are an indirection: when a new generation of models ships, swapping the tier-to-model map updates every function using that tier. You can also set a function to a custom model name if you want to pin it to something specific.
        </p>
        <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
          <li>Light  → <span className="text-foreground">{tierToModel.light}</span> (cheap, fast)</li>
          <li>Default → <span className="text-foreground">{tierToModel.default}</span> (balanced)</li>
          <li>Heavy  → <span className="text-foreground">{tierToModel.heavy}</span> (more reasoning, higher cost)</li>
        </ul>
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

                <CustomTierControl
                  functionId={functionId}
                  isCustom={s.tier === 'custom'}
                  currentValue={s.customModel ?? ''}
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

function CustomTierControl({
  functionId,
  isCustom,
  currentValue,
  disabled,
  onSet,
}: {
  functionId: AIFunctionId;
  isCustom: boolean;
  currentValue: string;
  disabled: boolean;
  onSet: (model: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentValue);

  if (!isCustom && !editing) {
    return (
      <button
        type="button"
        onClick={() => { setValue(currentValue); setEditing(true); }}
        disabled={disabled}
        className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        custom…
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={isCustom ? currentValue : 'e.g. gpt-5.4-nano'}
        className="rounded border border-input bg-background px-2 py-1 text-xs font-mono w-44 focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <button
        type="button"
        onClick={() => { onSet(value.trim()); setEditing(false); }}
        disabled={disabled || !value.trim()}
        className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        set
      </button>
      {!isCustom && (
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={disabled}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          cancel
        </button>
      )}
    </div>
  );
}
