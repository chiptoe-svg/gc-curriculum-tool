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
  type BundleSummary,
  type CardFields,
} from '@/lib/catalog/bundles';

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
