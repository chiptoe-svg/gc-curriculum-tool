import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KnockOn, WhatIfEstimate, WhatIfProfile } from '@/lib/what-if/types';

const complete = vi.fn();
const getProviderForFunction = vi.fn();
vi.mock('@/lib/ai/provider', () => ({ getProviderForFunction: (...a: unknown[]) => getProviderForFunction(...a) }));

import { writeWhatIfProse, RATING_IN_PROSE, WHAT_IF_PROSE_JSON_SCHEMA } from '@/lib/what-if/page-prose';

type Node = Record<string, unknown>;
function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) { node.forEach(n => walk(n, visit)); return; }
  if (!node || typeof node !== 'object') return;
  visit(node as Node);
  Object.values(node as Node).forEach(v => walk(v, visit));
}

const estimate: WhatIfEstimate = {
  changeItems: [{ kind: 'added', description: 'A calibrated proofing lab in week 5' }],
  movedRatings: [], newCompetencies: [], incomingChanges: [],
};
const profile: WhatIfProfile = {
  ratings: [
    { statement: 'Prepare print-ready files', type: 'technical', status: 'moved', kud: { k: 3, u: 4, d: 2 },
      before: { k: 3, u: 2, d: 3 }, confidence: 'medium', reason: 'r', subCompetencyId: null, linked: false },
    { statement: 'Manage color profiles', type: 'technical', status: 'new', kud: { k: 2, u: 2, d: 2 },
      before: null, confidence: 'low', reason: 'r', subCompetencyId: 'cm', linked: true },
    { statement: 'Attention to detail', type: 'foundational', status: 'approved', kud: { k: null, u: null, d: 3 },
      before: { k: null, u: null, d: 3 }, confidence: null, reason: null, subCompetencyId: null, linked: false },
  ],
  incomingChanges: [{ kind: 'raised', statement: 'Basic color theory', expected: { k: 3, u: 2, d: 1 }, subCompetencyId: 'ct', linked: true }],
};
const knockOn: KnockOn = {
  laterCourses: [{ courseCode: 'GC 4400', subCompetencyId: 'cm', label: 'Color management', effect: 'closed' }],
  earlierCourses: [{ statement: 'Basic color theory', label: 'Color theory', status: 'not_met', deliveredBy: [] }],
  careerTargets: [{ targetName: 'Prepress Specialist', label: 'Color management', before: 'D2', after: 'D4', direction: 'up' }],
  notComputed: [],
};
const input = {
  courseCode: 'GC 3460', courseTitle: 'Prepress Technology', currentDescription: 'Students learn prepress workflows.',
  estimate, profile, knockOn, needsTitle: true,
};
const good = {
  description: 'Students learn prepress workflows, including a proofing lab.', whatChanges: 'A lab is added.',
  neighbors: 'GC 4400 would find a gap closed.', questions: ['a?', 'b?', 'c?'], summary: 'Add a proofing lab.', title: 'Proofing lab',
};
const telemetry = { costUsdCents: 4, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 5, completionTokens: 6 };

beforeEach(() => {
  complete.mockReset(); getProviderForFunction.mockReset();
  getProviderForFunction.mockResolvedValue({ complete });
  complete.mockResolvedValue({ data: good, ...telemetry });
});

describe('what-if page prose', () => {
  it('the strict JSON schema: no extra keys, every property required, recursively', () => {
    let objects = 0;
    walk(WHAT_IF_PROSE_JSON_SCHEMA, n => {
      if (n.type !== 'object') return;
      objects++;
      expect(n.additionalProperties).toBe(false);
      expect([...(n.required as string[])].sort()).toEqual(Object.keys(n.properties as Node).sort());
    });
    expect(objects).toBe(1);
    expect((WHAT_IF_PROSE_JSON_SCHEMA.properties as Node).title).toEqual({ type: ['string', 'null'] });
  });

  it('RATING_IN_PROSE matches a rating and not ordinary words', () => {
    for (const s of ['reaches D3', 'a K 2 level', 'U5']) expect(RATING_IN_PROSE.test(s), s).toBe(true);
    for (const s of ['Week 5 lab', 'GC 4400', 'a D grade is rare', 'K-12']) expect(RATING_IN_PROSE.test(s), s).toBe(false);
  });

  it('the validator rejects prose that states a rating, in any text field', async () => {
    await writeWhatIfProse(input);
    const validate = complete.mock.calls[0]![0].validate as (raw: unknown) => unknown;
    expect(() => validate(good)).not.toThrow();
    expect(() => validate({ ...good, whatChanges: 'Students reach D3 by week 9.' })).toThrow();
    expect(() => validate({ ...good, questions: ['Is K 2 enough?', 'b?', 'c?'] })).toThrow();
    expect(() => validate({ ...good, summary: 'Raises U4' })).toThrow();
    expect(() => validate({ ...good, questions: ['only one?'] })).toThrow();
  });

  it('gives the model the current description and the change items', async () => {
    await writeWhatIfProse(input);
    const msg = complete.mock.calls[0]![0].userMessage as string;
    expect(msg).toContain('Students learn prepress workflows.');
    expect(msg).toContain('A calibrated proofing lab in week 5');
    expect(msg).toContain('Prepress Technology');
    expect(msg).toContain('Prepress Specialist');
  });

  it('gives ratings in words, never as K/U/D numbers', async () => {
    await writeWhatIfProse(input);
    const msg = complete.mock.calls[0]![0].userMessage as string;
    expect(msg).toMatch(/goes up/);
    expect(msg).toMatch(/goes down/);
    expect(msg).toMatch(/new/);
    expect(RATING_IN_PROSE.test(msg)).toBe(false);
  });

  it('asks for a title only when needed and returns null otherwise', async () => {
    const first = await writeWhatIfProse(input);
    expect(first.title).toBe('Proofing lab');
    expect(complete.mock.calls[0]![0].userMessage).toContain('Write a short title');
    complete.mockResolvedValue({ data: { ...good, title: 'Ignored' }, ...telemetry });
    const again = await writeWhatIfProse({ ...input, needsTitle: false });
    expect(again.title).toBeNull();
    expect(complete.mock.calls[1]![0].userMessage).toContain('Do not write a title');
  });

  it('returns the prose, summary and telemetry', async () => {
    const r = await writeWhatIfProse(input);
    expect(r.prose).toEqual({ description: good.description, whatChanges: good.whatChanges, neighbors: good.neighbors, questions: good.questions });
    expect(r.summary).toBe('Add a proofing lab.');
    expect(r.telemetry).toEqual(telemetry);
    expect(getProviderForFunction).toHaveBeenCalledWith('what-if-page', { courseCode: 'GC 3460' });
  });
});
