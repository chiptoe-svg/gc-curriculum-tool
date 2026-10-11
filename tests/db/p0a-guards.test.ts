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
    expect(filesMatching('snapshotTargetCoverage')).toEqual([]);
  });

  it('target membership is read from target_sub_competencies, not sub_competencies.career_target_id', () => {
    expect(filesMatching('subCompetencies\\.careerTargetId')).toEqual([]);
  });
});

// M-4 (adversarial review): the guards above only see the Drizzle identifiers
// (and the P0a rename made the old identifier name disappear everywhere
// except the untracked, gitignored one-off scripts the guard can't see
// anyway). A raw SQL string reading the same tables isn't covered. These two
// checks flag a tracked raw-SQL read of the backup table, or of
// sub_competencies' membership columns, in a FROM/SELECT context — narrow
// enough not to flag a comment or log message mentioning the names, and not
// to flag an INSERT into the still-written deprecated mirror (migrations,
// verify/rollback SQL and the seed script's intentional mirror write are
// excluded below; a multi-line template literal that splits the table name
// from the column name across lines is a known blind spot, same as the
// existing checks above).
function rawSqlFilesMatching(pattern: string): string[] {
  try {
    const out = execFileSync('git', [
      'grep', '--untracked', '-l', '-E', '-i', pattern, '--',
      'app', 'lib', 'scripts',
      ':(exclude)scripts/_one-off',
      ':(exclude,glob)scripts/migrations/*.sql',
      ':(exclude)scripts/seed-career-targets.ts', // M-5: intentional raw-SQL write to the deprecated mirror
      ':(exclude)lib/db/schema.ts',
      ':(exclude,glob)**/__tests__/**',
    ], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).sort();
  } catch (e) {
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
}

describe('P0a guards — raw SQL (M-4)', () => {
  it('no tracked raw SQL reads the backup table snapshot_target_coverage', () => {
    expect(rawSqlFilesMatching('FROM[[:space:]]+snapshot_target_coverage')).toEqual([]);
  });

  it('no tracked raw SQL reads sub_competencies membership via career_target_id or display_order', () => {
    expect(rawSqlFilesMatching('FROM[[:space:]]+sub_competencies.*(career_target_id|display_order)')).toEqual([]);
  });
});
