// @vitest-environment node
// P0a static guards: source under app/, lib/, scripts/ (schema.ts, __tests__
// and the tsconfig-excluded one-off scripts are not scanned).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

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

// P0b (Task 3): migration 0057 drops the deprecated mirror columns and the
// two P0a scaffolding tables. These four identifiers must not appear
// anywhere outside drizzle/ and scripts/migrations/ (both out of
// filesMatching's scanned scope already — see its pathspec above) — any hit
// means a file still writes a mirror or reads a dropped table that no
// longer exists post-0057.
describe('P0b guards — deprecated mirrors and dropped tables are gone', () => {
  it('no file writes the deprecated career_target_id mirror (deprecatedCareerTargetId)', () => {
    expect(filesMatching('deprecatedCareerTargetId')).toEqual([]);
  });

  it('no file writes the deprecated display_order mirror (deprecatedDisplayOrder)', () => {
    expect(filesMatching('deprecatedDisplayOrder')).toEqual([]);
  });

  it('no file references the dropped coverageScores Drizzle table', () => {
    // Character-class boundary (not \b — git grep -E has no \b support, per
    // the M-4 finding above) so this doesn't false-positive on the unrelated
    // AI schema exports coverageScoresSchema / coverageScoresJsonSchema in
    // lib/ai/schemas.ts.
    expect(filesMatching('coverageScores([^A-Za-z]|$)')).toEqual([]);
  });
});

// M-4 (adversarial review round 1) / M-c (round 2): the guards above only
// see the Drizzle identifiers (and the P0a rename made the old identifier
// name disappear everywhere except the untracked, gitignored one-off
// scripts the guard can't see anyway). A raw SQL string reading the same
// tables isn't covered by them at all.
//
// Round 1's version of this check used `git grep -E`, which (a) has no
// word-boundary support in its regex engine, (b) matches one line at a
// time, so a template literal that splits `FROM sub_competencies` from
// `WHERE career_target_id` across two lines was invisible, and (c) only
// matched a bare `FROM`, so `JOIN`/`INSERT INTO`/`UPDATE` all slipped
// through. The round-2 review planted exactly those six shapes in a
// temporary probe file and confirmed none were caught. Round 2 reads each
// file's full content in JS instead and matches with real regexes
// (`\b`, `[\s\S]` to cross line breaks, keyword alternation), which closes
// all three gaps at once.
//
// Scope: any read (FROM/JOIN) of snapshot_target_coverage OR of
// sub_competencies combined with career_target_id/display_order within 200
// characters. snapshot_target_coverage also flags INTO/UPDATE, because
// nothing legitimately writes it any more either (it's a frozen backup).
// sub_competencies does NOT flag INTO/UPDATE, because the deprecated
// mirror columns are still intentionally WRITTEN (migration 0056's header
// comment, STATE.md) — only reading them back via raw SQL is the guarded-
// against regression (M-c's seed-script fix below removes the one
// instance of that read that existed, so no file needs an exclusion here).
const RAW_SQL_SCOPE_ARGS = [
  'app', 'lib', 'scripts',
  ':(exclude)scripts/_one-off',
  ':(exclude,glob)scripts/migrations/*.sql',
  ':(exclude)lib/db/schema.ts',
  ':(exclude,glob)**/__tests__/**',
];

function rawSqlScopeFiles(): string[] {
  try {
    const out = execFileSync('git', [
      'ls-files', '--cached', '--others', '--exclude-standard', '--',
      ...RAW_SQL_SCOPE_ARGS,
    ], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch (e) {
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
}

function filesWithRawSqlPattern(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of rawSqlScopeFiles()) {
    let content: string;
    try {
      content = readFileSync(resolve(ROOT, file), 'utf8');
    } catch {
      continue; // listed then removed between ls-files and read — not a match
    }
    if (pattern.test(content)) hits.push(file);
  }
  return hits.sort();
}

const BACKUP_TABLE_PATTERN = /(FROM|JOIN|INTO|UPDATE)\s+"?snapshot_target_coverage\b/i;
const SUB_COMPETENCIES_MEMBERSHIP_PATTERN = /(FROM|JOIN)\s+"?sub_competencies\b[\s\S]{0,200}?(career_target_id|display_order)/i;
// P0b (Task 3): coverage_scores is dropped by migration 0057 alongside
// snapshot_target_coverage — same pattern shape, same scope (app/lib/scripts,
// excluding migrations/_one-off/schema.ts/__tests__; tests/ is out of scope
// entirely, which is where the P0a migration-rehearsal tests legitimately
// still touch these dropped tables in raw SQL against a pre-0057 clone).
const COVERAGE_SCORES_PATTERN = /(FROM|JOIN|INTO|UPDATE)\s+"?coverage_scores\b/i;

describe('P0a guards — raw SQL (M-4 / M-c)', () => {
  it('no tracked raw SQL reads or writes the backup table snapshot_target_coverage', () => {
    expect(filesWithRawSqlPattern(BACKUP_TABLE_PATTERN)).toEqual([]);
  });

  it('no tracked raw SQL reads sub_competencies membership via career_target_id or display_order', () => {
    expect(filesWithRawSqlPattern(SUB_COMPETENCIES_MEMBERSHIP_PATTERN)).toEqual([]);
  });

  it('no tracked raw SQL reads or writes the dropped table coverage_scores (P0b)', () => {
    expect(filesWithRawSqlPattern(COVERAGE_SCORES_PATTERN)).toEqual([]);
  });
});
