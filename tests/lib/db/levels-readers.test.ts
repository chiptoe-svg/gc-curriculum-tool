/**
 * Readers of a course's level on a competency read competency_levels (spec 2026-11-20-links-drive-coverage-design.md).
 * Only the scorer's own bookkeeping may read snapshot_competency_coverage directly: staleness, live-capture ordering
 * ("has it been scored"), and the post-scoring wiki pass ("what did the scorer just put above zero").
 * A new direct read fails here, so nothing quietly bypasses faculty decisions.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ALLOWED: Record<string, number> = {
  'lib/db/program-coverage-queries.ts': 1, // listStaleSnapshots: which cells exist
  'lib/db/live-captures.ts': 1,            // order captures by "scored at all"
  'lib/program/refresh-after-scoring.ts': 1, // what the scorer just put above zero
};
const READ = /(from|[Jj]oin)\(snapshotCompetencyCoverage|(FROM|JOIN) snapshot_competency_coverage/g;

describe('direct reads of the scorer table', () => {
  it('only the scorer bookkeeping reads snapshot_competency_coverage', () => {
    const files = execSync("git ls-files 'lib/**/*.ts' 'lib/*.ts' 'app/**/*.ts' 'app/**/*.tsx'", { encoding: 'utf8' })
      .split('\n').filter(f => f && !f.includes('__tests__'));
    const found: Record<string, number> = {};
    for (const f of files) {
      const n = (readFileSync(f, 'utf8').match(READ) ?? []).length;
      if (n) found[f] = n;
    }
    expect(found).toEqual(ALLOWED);
  });
});
