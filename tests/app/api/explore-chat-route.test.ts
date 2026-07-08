import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('explore chat route', () => {
  const src = readFileSync('app/api/explore/[code]/chat/route.ts', 'utf8');
  it('streams the explore agent, not curriculum-chat', () => {
    expect(src).toContain('streamExploreAgent');
    expect(src).not.toContain('streamCurriculumChat');
  });
  it('keeps slug auth + rate limiting', () => {
    expect(src).toMatch(/isValidSlug|slug/);
    expect(src).toMatch(/checkIpRateLimit|rate/i);
  });
});
