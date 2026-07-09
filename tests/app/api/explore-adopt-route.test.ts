import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
it('adopt route: POST, slug-gated, rate-limited, calls adoptScenario', () => {
  const src = readFileSync('app/api/explore/[code]/scenarios/[id]/adopt/route.ts', 'utf8');
  expect(src).toContain('export async function POST');
  expect(src).toMatch(/isValidSlug/);
  expect(src).toMatch(/checkIpRateLimit/);
  expect(src).toMatch(/adoptScenario/);
});
