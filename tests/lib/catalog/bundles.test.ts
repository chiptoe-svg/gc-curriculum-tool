// @vitest-environment node
// Task 5 — pure helpers in lib/catalog/bundles.ts: textHash, cardEmbedText
// (Ruling 7: the embed text carries what the bundle IS, never what it
// excludes) and parseCardsReviewFile (the owner-review-file contract that
// the draft/apply CLI and its DB test both depend on).
import { describe, it, expect } from 'vitest';
import {
  STRATA,
  textHash,
  cardEmbedText,
  parseCardsReviewFile,
  GOLDEN_QUOTAS,
  GOLDEN_SIZE,
  seededShuffle,
  drawGoldenSample,
  type BundleSummary,
  type CardFields,
} from '@/lib/catalog/bundles';
import type { BundleStratum } from '@/lib/db/schema';

describe('textHash', () => {
  it("hashes 'a' to its known sha256 hex digest", () => {
    expect(textHash('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  });
});

describe('cardEmbedText — Ruling 7 (carries what the bundle IS, not what it excludes)', () => {
  const bundle: BundleSummary = {
    id: 'test-bundle',
    name: 'MARKER_NAME',
    knowDescriptor: 'MARKER_KNOW',
    understandDescriptor: 'MARKER_UNDERSTAND',
    doDescriptor: 'MARKER_DO',
    origin: 'gc_authored',
  };
  const card: CardFields = {
    stratum: 'technical',
    includes: 'MARKER_INCLUDES',
    excludes: 'MARKER_EXCLUDES',
    distinctions: 'MARKER_DISTINCTIONS',
    positiveExamples: ['MARKER_POSITIVE_ONE', 'MARKER_POSITIVE_TWO'],
    negativeExamples: ['MARKER_NEGATIVE_ONE', 'MARKER_NEGATIVE_TWO'],
  };
  const text = cardEmbedText(bundle, card);

  it('includes the name, all three descriptors, includes, and each positive example', () => {
    expect(text).toContain('MARKER_NAME');
    expect(text).toContain('MARKER_KNOW');
    expect(text).toContain('MARKER_UNDERSTAND');
    expect(text).toContain('MARKER_DO');
    expect(text).toContain('MARKER_INCLUDES');
    expect(text).toContain('MARKER_POSITIVE_ONE');
    expect(text).toContain('MARKER_POSITIVE_TWO');
  });

  it('excludes the excludes, distinctions and negative-example text', () => {
    expect(text).not.toContain('MARKER_EXCLUDES');
    expect(text).not.toContain('MARKER_DISTINCTIONS');
    expect(text).not.toContain('MARKER_NEGATIVE_ONE');
    expect(text).not.toContain('MARKER_NEGATIVE_TWO');
  });
});

describe('parseCardsReviewFile', () => {
  const activeIds = new Set(['bundle-a', 'bundle-b']);

  function validCard(overrides: Record<string, unknown> = {}) {
    return {
      competencyId: 'bundle-a',
      name: 'Bundle A',
      stratum: 'technical',
      includes: 'includes text',
      excludes: 'excludes text',
      distinctions: 'distinctions text',
      positiveExamples: ['p1', 'p2'],
      negativeExamples: ['n1', 'n2'],
      ...overrides,
    };
  }

  function validFile(cards: unknown[], overrides: Record<string, unknown> = {}) {
    return {
      _approval: 'Approved',
      drafted: { model: 'test-model', promptVersion: 'bundle-card-draft@1', at: new Date().toISOString(), costUsdCents: 0 },
      cards,
      ...overrides,
    };
  }

  it('refuses an empty _approval when requireApproval is true', () => {
    const file = validFile([validCard(), validCard({ competencyId: 'bundle-b', name: 'Bundle B' })], { _approval: '' });
    expect(() => parseCardsReviewFile(file, activeIds, { requireApproval: true })).toThrow(/_approval/);
  });

  it('accepts an empty _approval when requireApproval is false', () => {
    const file = validFile([validCard(), validCard({ competencyId: 'bundle-b', name: 'Bundle B' })], { _approval: '' });
    expect(() => parseCardsReviewFile(file, activeIds, { requireApproval: false })).not.toThrow();
  });

  it('refuses a card for an id not in activeBundleIds', () => {
    const file = validFile([validCard({ competencyId: 'bundle-z' }), validCard({ competencyId: 'bundle-b', name: 'Bundle B' })]);
    expect(() => parseCardsReviewFile(file, activeIds, { requireApproval: true })).toThrow(/not an active catalog competency/);
  });

  it('refuses a missing card for an active id', () => {
    const file = validFile([validCard()]); // bundle-b missing
    expect(() => parseCardsReviewFile(file, activeIds, { requireApproval: true })).toThrow(/no card for active competency/);
  });

  it('refuses a duplicate id', () => {
    const file = validFile([validCard(), validCard()]);
    expect(() => parseCardsReviewFile(file, activeIds, { requireApproval: true })).toThrow(/duplicate card/);
  });

  it('refuses a stratum outside STRATA', () => {
    const file = validFile([validCard({ stratum: 'nonsense' }), validCard({ competencyId: 'bundle-b', name: 'Bundle B' })]);
    expect(() => parseCardsReviewFile(file, activeIds, { requireApproval: true })).toThrow(/stratum must be one of/);
  });

  it('refuses an empty includes', () => {
    const file = validFile([validCard({ includes: '' }), validCard({ competencyId: 'bundle-b', name: 'Bundle B' })]);
    expect(() => parseCardsReviewFile(file, activeIds, { requireApproval: true })).toThrow(/includes/);
  });

  it('refuses positiveExamples with fewer than 2 entries', () => {
    const file = validFile([validCard({ positiveExamples: ['only-one'] }), validCard({ competencyId: 'bundle-b', name: 'Bundle B' })]);
    expect(() => parseCardsReviewFile(file, activeIds, { requireApproval: true })).toThrow(/positiveExamples.*2–3 entries/);
  });

  it('refuses positiveExamples with more than 3 entries', () => {
    const file = validFile([validCard({ positiveExamples: ['p1', 'p2', 'p3', 'p4'] }), validCard({ competencyId: 'bundle-b', name: 'Bundle B' })]);
    expect(() => parseCardsReviewFile(file, activeIds, { requireApproval: true })).toThrow(/positiveExamples.*2–3 entries/);
  });

  it('refuses a non-string example', () => {
    const file = validFile([validCard({ positiveExamples: ['p1', 42] }), validCard({ competencyId: 'bundle-b', name: 'Bundle B' })]);
    expect(() => parseCardsReviewFile(file, activeIds, { requireApproval: true })).toThrow(/positiveExamples/);
  });

  it('accepts a valid file and returns the cards sorted by competencyId', () => {
    const file = validFile([
      validCard({ competencyId: 'bundle-b', name: 'Bundle B' }),
      validCard({ competencyId: 'bundle-a', name: 'Bundle A' }),
    ]);
    const parsed = parseCardsReviewFile(file, activeIds, { requireApproval: true });
    expect(parsed.cards.map(c => c.competencyId)).toEqual(['bundle-a', 'bundle-b']);
    expect(parsed._approval).toBe('Approved');
    expect(parsed.drafted.model).toBe('test-model');
  });

  it('STRATA matches the schema BundleStratum union', () => {
    expect(STRATA).toEqual(['foundational', 'technical', 'business', 'workflow_ai']);
  });
});

describe('seededShuffle — Task 7', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);

  it('gives the same order for the same seed', () => {
    const a = seededShuffle(items, 'seed-one');
    const b = seededShuffle(items, 'seed-one');
    expect(a).toEqual(b);
  });

  it('gives a different order for a different seed on a 20-item list', () => {
    const a = seededShuffle(items, 'seed-one');
    const b = seededShuffle(items, 'seed-two');
    expect(a).not.toEqual(b);
  });

  it('does not mutate the input', () => {
    const original = [...items];
    seededShuffle(items, 'seed-one');
    expect(items).toEqual(original);
  });

  it('returns a permutation (same multiset of items)', () => {
    const shuffled = seededShuffle(items, 'seed-one');
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });
});

describe('drawGoldenSample — Task 7', () => {
  function bundle(id: string, stratum: BundleStratum) {
    return { id, stratum };
  }

  function manyPerStratum(countsByStratum: Record<BundleStratum, number>) {
    const bundles: Array<{ id: string; stratum: BundleStratum }> = [];
    for (const stratum of STRATA) {
      const n = countsByStratum[stratum];
      for (let i = 0; i < n; i++) bundles.push(bundle(`${stratum}-${i}`, stratum));
    }
    return bundles;
  }

  it('takes the quota from each stratum (2/3/2/1) when enough are available', () => {
    const bundles = manyPerStratum({ foundational: 5, technical: 5, business: 5, workflow_ai: 5 });
    const picked = drawGoldenSample(bundles, 'seed-a');
    expect(picked).toHaveLength(GOLDEN_SIZE);
    const countByStratum: Record<string, number> = {};
    for (const p of picked) countByStratum[p.stratum] = (countByStratum[p.stratum] ?? 0) + 1;
    expect(countByStratum).toEqual(GOLDEN_QUOTAS);
  });

  it('still includes the single workflow_ai bundle when only 1 exists', () => {
    const bundles = manyPerStratum({ foundational: 5, technical: 5, business: 5, workflow_ai: 1 });
    const picked = drawGoldenSample(bundles, 'seed-a');
    expect(picked.some(p => p.id === 'workflow_ai-0')).toBe(true);
    expect(picked.filter(p => p.stratum === 'workflow_ai')).toHaveLength(1);
  });

  it('fills missing slots from the remaining pool when a stratum has 0 bundles, keeping size 8', () => {
    const bundles = manyPerStratum({ foundational: 5, technical: 5, business: 0, workflow_ai: 1 });
    const picked = drawGoldenSample(bundles, 'seed-a');
    expect(picked).toHaveLength(GOLDEN_SIZE);
    expect(picked.filter(p => p.stratum === 'business')).toHaveLength(0);
    // No duplicate ids.
    expect(new Set(picked.map(p => p.id)).size).toBe(GOLDEN_SIZE);
  });

  it('returns them all when fewer than 8 bundles exist in total', () => {
    const bundles = manyPerStratum({ foundational: 2, technical: 1, business: 1, workflow_ai: 1 });
    const picked = drawGoldenSample(bundles, 'seed-a');
    expect(picked).toHaveLength(bundles.length);
    expect(new Set(picked.map(p => p.id))).toEqual(new Set(bundles.map(b => b.id)));
  });

  it('is deterministic for a given seed', () => {
    const bundles = manyPerStratum({ foundational: 5, technical: 5, business: 5, workflow_ai: 5 });
    const a = drawGoldenSample(bundles, 'seed-a');
    const b = drawGoldenSample(bundles, 'seed-a');
    expect(a).toEqual(b);
  });

  it('never picks the same id twice', () => {
    const bundles = manyPerStratum({ foundational: 5, technical: 5, business: 5, workflow_ai: 5 });
    const picked = drawGoldenSample(bundles, 'seed-a');
    expect(new Set(picked.map(p => p.id)).size).toBe(picked.length);
  });
});
