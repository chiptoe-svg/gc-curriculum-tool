import { describe, it, expect } from 'vitest';
import { plainDepth, plainDepthPhrase, plainScores, PLAIN_DEPTH } from '@/lib/capture/plain-depth';

describe('PLAIN_DEPTH phrase tables', () => {
  it('has six levels per dimension', () => {
    for (const dim of ['k', 'u', 'd'] as const) expect(PLAIN_DEPTH[dim]).toHaveLength(6);
  });
  it('maps a single dimension + level to its phrase', () => {
    expect(plainDepthPhrase('d', 3)).toBe('does it independently in familiar situations');
    expect(plainDepthPhrase('u', 2)).toBe('explains it in their own words');
    expect(plainDepthPhrase('k', 2)).toBe('recognizes it');
  });
});

describe('plainScores (structured scores → words)', () => {
  it('joins Know and Understand with "and", Do after a semicolon', () => {
    expect(plainScores({ k: 2, u: 2, d: 1 })).toBe(
      'recognizes it and explains it in their own words; does it with step-by-step direction',
    );
  });
  it('skips null dimensions (foundational: Do only)', () => {
    expect(plainScores({ k: null, u: null, d: 3 })).toBe('does it independently in familiar situations');
  });
});

describe('plainDepth — rewriting score codes inside AI-written text', () => {
  const cases: Array<[string, string]> = [
    // single tokens
    ['D3', 'does it independently in familiar situations'],
    ['Strongest at D4.', 'Strongest at adapts it to new conditions.'],
    ['U0 throughout', "doesn't yet reason about why throughout"],
    // the synthesis prompt's own bullet format: "{statement} — D{N} via {Assignment}"
    [
      'Builds a production budget — D3 via Budget',
      'Builds a production budget — does it independently in familiar situations (Budget assignment)',
    ],
    [
      'Students produce and evaluate proofs — D4 via ISO 12647-7 Control Wedge',
      'Students produce and evaluate proofs — adapts it to new conditions (ISO 12647-7 Control Wedge assignment)',
    ],
    // assignment names that already say what they are don't get "assignment" appended
    [
      'Measures color — D5 via Brand Color Report',
      'Measures color — does it creatively and guides others (Brand Color Report)',
    ],
    [
      'Prints a job — D4 via Press Check Lab; strong rubric',
      'Prints a job — adapts it to new conditions (Press Check Lab); strong rubric',
    ],
    // combos
    [
      'Color theory K2/U2/D1',
      'Color theory recognizes it and explains it in their own words; does it with step-by-step direction',
    ],
    [
      'Imposition (K1/U0/D1)',
      "Imposition (has met it and doesn't yet reason about why; does it with step-by-step direction)",
    ],
    ['K4 · U2 · D3', 'uses the correct terms and explains it in their own words; does it independently in familiar situations'],
    ['K3/D2', 'recalls it without prompting; does it with a reference or checklist'],
    // combos out of K/U/D order are normalized to K, U, D
    ['D1/K2', 'recognizes it; does it with step-by-step direction'],
    // ranges
    ['the deepest D4–5 evidence', 'the deepest adapts it to new conditions or does it creatively and guides others evidence'],
    ['maps to D3–D4', 'maps to does it independently in familiar situations or adapts it to new conditions'],
    ['U1-2', 'can restate the explanation or explains it in their own words'],
    // equals form the prompt itself uses ("scored D=0")
    ['Resilience scored D=0', 'Resilience scored no evidence students do it yet'],
    // dissociation shorthand
    ['Kerning is K1-only', 'Kerning is only mentioned, never practiced'],
    ['K-high with U-low', 'knows the terms well with little reasoning about why'],
    ['D-high, U-low on press work', 'strong hands-on work, little reasoning about why on press work'],
    ['where the K/U/D scores cluster', 'where the knowing / reasoning / doing scores cluster'],
    // real GC 3800 summary strings (2026-10-06 screenshot)
    [
      'LinkedIn profile development — D2/U1: profile construction with limited feedback on rationale',
      'LinkedIn profile development — can restate the explanation; does it with a reference or checklist: profile construction with limited feedback on rationale',
    ],
    [
      'Career-development services participation — K1/U0/D1: exposure and attendance',
      "Career-development services participation — has met it and doesn't yet reason about why; does it with step-by-step direction: exposure and attendance",
    ],
    [
      'Communication — D3 via Internship Fair',
      'Communication — does it independently in familiar situations (Internship Fair)',
    ],
    [
      'Attention to Detail — D3 via Courselineup/Budget grading',
      'Attention to Detail — does it independently in familiar situations (Courselineup/Budget grading)',
    ],
    // two separate tokens joined by prose stay separate
    ['D3 and D4', 'does it independently in familiar situations and adapts it to new conditions'],
  ];
  it.each(cases)('%s', (input, expected) => {
    expect(plainDepth(input)).toBe(expected);
  });

  const untouched = [
    'GC 3800 builds on GC 2400.',
    'ISO 12647-7 control strips',
    'K-12 outreach day',
    'Page D12 of the reader',
    'The AD4 file and the D4K variant',
    'Uses a 4K monitor and U.S. letter stock',
    'Section K6 of the handbook',
    'lowercase d3 and k2 are left alone',
    'CMYK4 swatches',
    'Drawing a D shape',
    '',
  ];
  it.each(untouched)('leaves "%s" alone', (s) => {
    expect(plainDepth(s)).toBe(s);
  });

  it('is idempotent (rewriting twice changes nothing more)', () => {
    const once = plainDepth('Color K2/U2/D1 — D3 via Budget');
    expect(plainDepth(once)).toBe(once);
  });
});
