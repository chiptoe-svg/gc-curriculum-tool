import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
it('adopt route: POST, slug-gated, rate-limited, calls adoptScenario', () => {
  const src = readFileSync('app/api/explore/[code]/scenarios/[id]/adopt/route.ts', 'utf8');
  expect(src).toContain('export async function POST');
  expect(src).toMatch(/isValidSlug/);
  expect(src).toMatch(/checkIpRateLimit/);
  expect(src).toMatch(/adoptScenario/);
  // cross-course guard: the [code] segment is passed to adoptScenario so a
  // scenario belonging to another course can't be adopted under this URL.
  expect(src).toMatch(/adoptScenario\(\s*id\s*,\s*courseCode\s*\)/);
});
