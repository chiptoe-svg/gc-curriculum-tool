import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
describe('explore page', () => {
  const src = readFileSync('app/explore/[code]/page.tsx', 'utf8');
  it('renders the chat surface, not the old client', () => {
    expect(src).not.toContain('ExploreClient');
    expect(src).not.toContain('listTargetsByCourse');
    expect(src).not.toContain('listAnalysesByCourse');
    expect(src).toContain('AskTab');
  });
});
