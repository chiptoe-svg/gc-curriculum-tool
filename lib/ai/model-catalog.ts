/**
 * The models /settings offers by default (owner, 2026-11-20): models we use or have tested, plus the
 * newest OpenAI models marked untested. The gateway lists ~100 more (gpt-4o, gpt-4.1, o3, …); those stay
 * behind a "show everything" switch because nobody has tried them on our prompts.
 */
import { CAMPUS_MODELS, MODEL_PRICING } from '@/lib/ai/models';

export interface CatalogModel {
  id: string;
  provider: 'openai' | 'campus';
  price: string;
  note: string | null;
}

const OPENAI_VETTED: Array<{ id: string; note: string | null }> = [
  { id: 'gpt-6.1-sol', note: null },
  { id: 'gpt-6.1-terra', note: null },
  { id: 'gpt-6.2-sol', note: 'not tested here' },
  { id: 'gpt-6.2-astra', note: 'not tested here' },
  { id: 'gpt-5.4-mini', note: null },
  { id: 'gpt-5.4-nano', note: null },
];

function priceOf(id: string): string {
  const p = MODEL_PRICING[id];
  return p ? `$${p.input.toFixed(2)} / $${p.output.toFixed(2)} per M tokens` : 'price not on file';
}

export const VETTED_MODELS: CatalogModel[] = [
  ...OPENAI_VETTED.map(m => ({ id: m.id, provider: 'openai' as const, price: priceOf(m.id), note: m.note })),
  ...CAMPUS_MODELS.map(id => ({ id, provider: 'campus' as const, price: 'free', note: null })),
];

export interface PickerGroup {
  label: string;
  models: Array<{ id: string; text: string }>;
}

const text = (m: CatalogModel) => [m.id, m.price, m.note].filter(Boolean).join(' · ');

/** Picker groups: a model pinned now but in no list first, then OpenAI, Campus, and (when asked) the rest of the gateway list. */
export function pickerGroups(gateway: string[], showAll: boolean, current: string | null): PickerGroup[] {
  const vettedIds = new Set(VETTED_MODELS.map(m => m.id));
  const rest = showAll ? gateway.filter(id => !vettedIds.has(id)) : [];
  const groups: PickerGroup[] = [];
  if (current && !vettedIds.has(current) && !rest.includes(current)) {
    groups.push({ label: 'Pinned now', models: [{ id: current, text: current }] });
  }
  groups.push({ label: 'OpenAI', models: VETTED_MODELS.filter(m => m.provider === 'openai').map(m => ({ id: m.id, text: text(m) })) });
  groups.push({ label: 'Campus (free)', models: VETTED_MODELS.filter(m => m.provider === 'campus').map(m => ({ id: m.id, text: text(m) })) });
  if (rest.length > 0) groups.push({ label: 'Everything the gateway offers', models: rest.map(id => ({ id, text: id })) });
  return groups;
}
