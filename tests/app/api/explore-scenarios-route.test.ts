import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
describe('scenarios/[id] save route', () => {
  const src = readFileSync('app/api/explore/[code]/scenarios/[id]/route.ts', 'utf8');
  it('exports PATCH, slug-gated, uses the scenario repo', () => {
    expect(src).toContain('export async function PATCH');
    expect(src).toMatch(/isValidSlug/);
    expect(src).toMatch(/getScenario/);
    expect(src).toMatch(/saveScenario/);
  });
  it('applies IP rate limiting', () => {
    expect(src).toMatch(/checkIpRateLimit/);
  });
});
