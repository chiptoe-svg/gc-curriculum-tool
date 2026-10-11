// @vitest-environment node
// P0a static guards: source under app/, lib/, scripts/ (schema.ts, __tests__
// and the tsconfig-excluded one-off scripts are not scanned).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

function filesMatching(pattern: string): string[] {
  try {
    const out = execFileSync('git', [
      'grep', '--untracked', '-l', '-E', pattern, '--',
      'app', 'lib', 'scripts',
      ':(exclude)scripts/_one-off',
      ':(exclude)lib/db/schema.ts',
      ':(exclude,glob)**/__tests__/**',
    ], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).sort();
  } catch (e) {
    if ((e as { status?: number }).status === 1) return []; // git grep: no matches
    throw e;
  }
}

describe('P0a guards', () => {
  it('coverage is read from snapshot_competency_coverage / target_coverage, not the backup table', () => {
    expect(filesMatching('snapshotTargetCoverage')).toEqual([
      'lib/capture/run-course-reset.ts',    // TRANSITIONAL dual-write; emptied in Task 7
      'lib/db/program-coverage-queries.ts', // TRANSITIONAL dual-write; emptied in Task 7
    ]);
  });
});
