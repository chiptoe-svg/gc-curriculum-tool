'use client';

/**
 * Page5Section — "Rate experiences worth having".
 *
 * ratedSkills shape written here:
 *   ratedSkills.items  — Array<{ name, description?, evidence_source?, sub_competency_id?, rating }>
 *   ratedSkills.generatedAt — ISO timestamp set on first successful generate
 *
 * Rating-default choice: UNSET (undefined) until the partner moves the slider.
 * Rationale: defaulting all to 4 trivially satisfies the min-5-ratings gate
 * without any partner intent; unset forces deliberate engagement. A card with
 * no slider movement is not counted toward the minimum-5 requirement.
 *
 * Min-5 gate: exposed upward via `onValidityChange(bool)`. PositionWizard
 * disables the Next button for step 5 when this is false.
 *
 * sub_competency_id and evidence_source from the AI are preserved verbatim
 * in the saved ratedSkills.items so the A2 join key is never dropped.
 */

import { useState } from 'react';

/** Richer item shape — AI extra fields preserved through to persistence */
export interface RatedSkillItem {
  name: string;
  description?: string;
  evidence_source?: string;
  sub_competency_id?: string | null;
  /** Undefined = not yet rated by the partner (does not count toward min-5) */
  rating?: number;
}

export interface RatedSkillsValue {
  items: RatedSkillItem[];
  generatedAt: string;
}

interface Patch {
  ratedSkills?: RatedSkillsValue;
}

interface Props {
  token: string;
  captureId: string;
  structuredInputs: Record<string, unknown>;
  positionTitle: string | null;
  ratedSkills: RatedSkillsValue | null;
  onChange: (patch: Patch) => void;
  onValidityChange: (valid: boolean) => void;
}

const MIN_RATED = 5;

function hasRating(item: RatedSkillItem): boolean {
  return typeof item.rating === 'number';
}

export function Page5Section({
  token,
  captureId,
  positionTitle,
  ratedSkills,
  onChange,
  onValidityChange,
}: Props) {
  // Local items state — mirrors what we emit upstream
  const [items, setItems] = useState<RatedSkillItem[]>(ratedSkills?.items ?? []);
  const [generatedAt, setGeneratedAt] = useState<string>(ratedSkills?.generatedAt ?? '');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  function emit(nextItems: RatedSkillItem[], nextGeneratedAt?: string) {
    const gAt = nextGeneratedAt ?? generatedAt ?? new Date().toISOString();
    const value: RatedSkillsValue = { items: nextItems, generatedAt: gAt };
    onChange({ ratedSkills: value });
    onValidityChange(nextItems.filter(hasRating).length >= MIN_RATED);
  }

  async function handleGenerate() {
    setGenError(null);
    setGenerating(true);
    try {
      const res = await fetch(
        `/api/partners/${encodeURIComponent(token)}/positions/${encodeURIComponent(captureId)}/generate-items`,
        { method: 'POST' },
      );
      const data = await res.json() as {
        items?: Array<{
          name: string;
          description: string;
          evidence_source: string;
          sub_competency_id: string | null;
        }>;
        error?: string;
      };
      if (!res.ok || !data.items) {
        const msg = data.error ?? 'generation failed';
        if (res.status === 400) {
          setGenError('Please complete the earlier pages (job description + structured inputs) first before generating.');
        } else {
          setGenError(msg);
        }
        return;
      }
      // Map AI items → local items; rating starts unset
      const newItems: RatedSkillItem[] = data.items.map(ai => ({
        name: ai.name,
        description: ai.description,
        evidence_source: ai.evidence_source,
        sub_competency_id: ai.sub_competency_id,
        // rating deliberately omitted — partner must move the slider
      }));
      const now = new Date().toISOString();
      setItems(newItems);
      setGeneratedAt(now);
      emit(newItems, now);
    } catch {
      setGenError('Network error — please try again.');
    } finally {
      setGenerating(false);
    }
  }

  function updateItem(index: number, patch: Partial<RatedSkillItem>) {
    const next = items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    setItems(next);
    emit(next);
  }

  function removeItem(index: number) {
    const next = items.filter((_, i) => i !== index);
    setItems(next);
    emit(next);
  }

  function addItem() {
    const next: RatedSkillItem[] = [
      ...items,
      {
        name: '',
        description: '',
        evidence_source: '',
        sub_competency_id: null,
        // rating starts unset — same rule as AI-generated cards
      },
    ];
    setItems(next);
    emit(next);
  }

  const ratedCount = items.filter(hasRating).length;
  const needsMore = ratedCount < MIN_RATED;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-4">
        <h2 className="mb-1 text-base font-semibold text-slate-800">Experiences worth having</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Below are experiences that tend to matter for{' '}
          <strong>{positionTitle || 'this position'}</strong>. Rate how important each one is
          for a student entering this field (1 = nice-to-have, 7 = essential).
        </p>

        <button
          type="button"
          disabled={generating}
          onClick={handleGenerate}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {generating ? (
            <>
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Generating…
            </>
          ) : items.length > 0 ? (
            'Re-generate experiences'
          ) : (
            'Generate experiences'
          )}
        </button>

        {genError && (
          <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
            {genError}
          </p>
        )}
      </section>

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((item, i) => (
            <ExperienceCard
              key={i}
              index={i}
              item={item}
              onUpdate={patch => updateItem(i, patch)}
              onRemove={() => removeItem(i)}
            />
          ))}

          <button
            type="button"
            onClick={addItem}
            className="w-full rounded-md border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-700"
          >
            + Add your own experience
          </button>

          {needsMore && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Rate at least {MIN_RATED} experiences to continue —{' '}
              {ratedCount} of {MIN_RATED} rated so far. Move a slider to record a rating.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  index: number;
  item: RatedSkillItem;
  onUpdate: (patch: Partial<RatedSkillItem>) => void;
  onRemove: () => void;
}

function ExperienceCard({ index, item, onUpdate, onRemove }: CardProps) {
  const rated = typeof item.rating === 'number';

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          {/* Editable name */}
          <input
            type="text"
            value={item.name}
            onChange={e => onUpdate({ name: e.target.value })}
            placeholder="Experience name"
            className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-medium text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-0"
          />

          {/* Read-only description */}
          {item.description && (
            <p className="text-sm text-slate-600">{item.description}</p>
          )}

          {/* Muted evidence_source */}
          {item.evidence_source && (
            <p className="text-xs text-muted-foreground italic">{item.evidence_source}</p>
          )}

          {/* 1–7 slider */}
          <div className="flex items-center gap-3 pt-1">
            <span className="w-24 shrink-0 text-xs text-slate-500">Importance</span>
            <input
              type="range"
              min={1}
              max={7}
              step={1}
              value={rated ? item.rating : 4}
              onChange={e => onUpdate({ rating: Number(e.target.value) })}
              onClick={(e) => { if (!rated) onUpdate({ rating: Number((e.currentTarget as HTMLInputElement).value) }); }}
              className="flex-1 accent-slate-800"
            />
            <span
              className={`w-8 text-center text-sm font-semibold tabular-nums ${
                rated ? 'text-slate-800' : 'text-slate-400'
              }`}
            >
              {rated ? item.rating : '–'}
            </span>
          </div>
          {!rated && (
            <p className="text-xs text-slate-400">Move the slider to set a rating.</p>
          )}
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove experience ${index + 1}`}
          className="mt-0.5 shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
        >
          ×
        </button>
      </div>
    </div>
  );
}
