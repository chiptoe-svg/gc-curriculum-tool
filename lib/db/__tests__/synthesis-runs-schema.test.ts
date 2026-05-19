import { describe, it, expect } from 'vitest';
import { synthesisRuns } from '@/lib/db/schema';

describe('synthesis_runs schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(synthesisRuns);
    for (const c of ['id', 'careerTargetId', 'submissionCount', 'result', 'model', 'costUsdCents', 'createdAt']) {
      expect(cols).toContain(c);
    }
  });
});
