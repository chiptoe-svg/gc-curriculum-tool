import { describe, it, expect } from 'vitest';
import { prototypeRuns } from '@/lib/db/schema';

describe('prototype_runs.analysis_kind column', () => {
  it('exists on the prototypeRuns table', () => {
    expect(Object.keys(prototypeRuns)).toContain('analysisKind');
  });
});
