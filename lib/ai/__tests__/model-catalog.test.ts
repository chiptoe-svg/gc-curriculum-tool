import { describe, expect, it } from 'vitest';
import { VETTED_MODELS, pickerGroups } from '@/lib/ai/model-catalog';
import { CAMPUS_MODELS } from '@/lib/ai/models';

describe('model catalog', () => {
  it('lists the vetted OpenAI models in order, then the campus models', () => {
    const groups = pickerGroups([], false, null);
    expect(groups.map(g => g.label)).toEqual(['OpenAI', 'Campus (free)']);
    expect(groups[0]!.models.map(m => m.id)).toEqual(['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-5.4-mini', 'gpt-5.4-nano']);
    expect(groups[1]!.models.map(m => m.id)).toEqual([...CAMPUS_MODELS]);
  });

  it('shows price, free, or no price on file', () => {
    const byId = Object.fromEntries(VETTED_MODELS.map(m => [m.id, m])) as Record<string, (typeof VETTED_MODELS)[number]>;
    expect(byId['gpt-6.1-terra']!.price).toBe('$1.00 / $5.00 per M tokens');
    expect(byId['glm-5.3']!.price).toBe('free');
    // 6.2 prices came with the Clemson reference (2026-11-21), via lib/ai/prices.ts.
    expect(byId['gpt-6.2-sol']!.price).toBe('$2.00 / $10.00 per M tokens');
    expect(byId['gpt-6.2-astra']!.price).toBe('$8.00 / $40.00 per M tokens');
    expect(byId['gpt-6.2-sol']!.note).toBe('not tested here');
    const text = pickerGroups([], false, null)[1]!.models[0]!.text;
    expect(text).toContain('free');
  });

  it('adds the rest of the gateway list only when asked, without repeats', () => {
    const gateway = ['gpt-6.1-sol', 'gpt-4.1', 'o3'];
    expect(pickerGroups(gateway, false, null)).toHaveLength(2);
    const all = pickerGroups(gateway, true, null);
    expect(all[2]).toMatchObject({ label: 'Everything the gateway offers' });
    expect(all[2]!.models.map(m => m.id)).toEqual(['gpt-4.1', 'o3']);
  });

  it('keeps a pinned model that is in no list', () => {
    const groups = pickerGroups(['gpt-4.1'], false, 'gpt-4.1');
    expect(groups[0]).toMatchObject({ label: 'Pinned now' });
    expect(groups[0]!.models.map(m => m.id)).toEqual(['gpt-4.1']);
    const ids = pickerGroups(['gpt-4.1'], true, 'gpt-4.1').flatMap(g => g.models.map(m => m.id));
    expect(ids.filter(i => i === 'gpt-4.1')).toHaveLength(1);
  });
});
