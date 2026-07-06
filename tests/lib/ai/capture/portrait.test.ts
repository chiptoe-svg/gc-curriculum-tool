import { describe, it, expect } from 'vitest';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import { portraitClauses, lowerAnchorOptions, evidencePromptFor, dimLabel } from '@/lib/ai/capture/portrait';

const technical: CaptureCompetency = {
  statement: 'Analyze packaging requirements',
  type: 'technical',
  k_depth: 4, u_depth: 2, d_depth: 3,
  evidence_k: 'quiz', evidence_u: 'memo', evidence_d: 'project',
  rationale: 'x',
  k_says: 'They use the right terms.', u_says: 'They explain why.', d_says: 'They do it on familiar cases.',
};

describe('portraitClauses', () => {
  it('returns one clause per scored dimension for a technical competency', () => {
    const cs = portraitClauses(technical);
    expect(cs.map(c => c.dim)).toEqual(['k', 'u', 'd']);
    expect(cs.map(c => c.text)).toEqual(['They use the right terms.', 'They explain why.', 'They do it on familiar cases.']);
  });

  it('renders Do-only for a foundational competency', () => {
    const f: CaptureCompetency = { ...technical, type: 'foundational', k_depth: null, u_depth: null, k_says: null, u_says: null, d_says: 'Consistently attends to detail.' };
    const cs = portraitClauses(f);
    expect(cs.map(c => c.dim)).toEqual(['d']);
    expect(cs[0]!.text).toBe('Consistently attends to detail.');
  });

  it('falls back to the generic depth anchor when a says field is null', () => {
    const legacy: CaptureCompetency = { ...technical, u_says: null };
    const cs = portraitClauses(legacy);
    const u = cs.find(c => c.dim === 'u')!;
    expect(u.text).toBe('Explains the rationale in own words'); // describeDepth('u', 2)
    expect(u.fallback).toBe(true);
  });

  it('shows the generic "Not present" anchor at depth 0 even if a says sentence is set', () => {
    const zeroWithSays: CaptureCompetency = { ...technical, d_depth: 0, d_says: 'Your students do this well.' };
    const cs = portraitClauses(zeroWithSays);
    const d = cs.find(c => c.dim === 'd')!;
    expect(d.fallback).toBe(true);
    expect(d.text).toBe('Not present'); // describeDepth('d', 0)
  });
});

describe('lowerAnchorOptions', () => {
  it('lists every level below the current one, with anchor text', () => {
    const opts = lowerAnchorOptions('u', 2);
    expect(opts.map(o => o.level)).toEqual([0, 1]);
    expect(opts[1]!.text).toBe('Restates the explanation as given'); // describeDepth('u', 1)
  });

  it('returns empty when the current level is 0', () => {
    expect(lowerAnchorOptions('d', 0)).toEqual([]);
  });
});

describe('evidencePromptFor', () => {
  it('is dimension-specific', () => {
    expect(evidencePromptFor('k')).toMatch(/exam|quiz|item/i);
    expect(evidencePromptFor('u')).toMatch(/explanation|reasoning/i);
    expect(evidencePromptFor('d')).toMatch(/artifact|rubric|graded/i);
  });
});

describe('dimLabel', () => {
  it('maps k/u/d to friendly labels', () => {
    expect([dimLabel('k'), dimLabel('u'), dimLabel('d')]).toEqual(['Naming', 'Reasoning', 'Doing']);
  });
});
