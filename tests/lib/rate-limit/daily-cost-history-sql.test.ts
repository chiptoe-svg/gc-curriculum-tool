// /settings 500'd (found 2026-10-07): daily_cost.day is TEXT ('YYYY-MM-DD') and the
// history query compared it with a timestamp (`text >= timestamp`, Postgres 42883).
// The window bound must be rendered as text in the same format.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('getDailyCostHistory SQL', () => {
  it('compares the text day column with a text bound', () => {
    const src = readFileSync('lib/rate-limit/daily-cap.ts', 'utf8');
    const q = src.slice(src.indexOf('export async function getDailyCostHistory'));
    expect(q).toMatch(/WHERE day >= to_char\(CURRENT_DATE - MAKE_INTERVAL\(days => \$\{days - 1\}::int\), 'YYYY-MM-DD'\)/);
  });
});
