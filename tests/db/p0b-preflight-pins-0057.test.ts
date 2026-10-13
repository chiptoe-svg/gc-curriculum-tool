// @vitest-environment node
// n3 (final review, 2026-10-12): scripts/migrations/p0b-preflight.sh is a
// hand-maintained PARALLEL of drizzle/0057_competency_catalog_p0b.sql's own
// precondition DO block and pre_counts formula (it can't be a literal
// extraction — 0057 uses CREATE TEMP TABLE, which Postgres refuses inside a
// BEGIN READ ONLY transaction; the preflight uses an equivalent read-only
// CTE instead — see the comment at the top of p0b-preflight.sh). Nothing
// enforced the two copies staying in sync. This test pins them together: it
// extracts the precondition DO-block body and the pre_counts count formula
// from BOTH files and asserts they are textually identical after
// normalizing away whitespace/comment differences. If 0057's merge_plan,
// precondition checks, or count formula ever change without the preflight
// script being updated to match, this test fails.
//
// Pure text comparison — no DB connection, no gating, runs everywhere.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFLIGHT_PATH = resolve(__dirname, '../../scripts/migrations/p0b-preflight.sh');
const MIGRATION_PATH = resolve(__dirname, '../../drizzle/0057_competency_catalog_p0b.sql');

/** Strip SQL line comments, collapse all whitespace runs to a single space, trim. */
function normalizeSql(text: string): string {
  return text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Undo the bash single-quote escaping p0b-preflight.sh uses to embed a
 * single-quoted SQL string inside its own single-quoted heredoc-less
 * string: `'"'"'` is bash's way of writing a literal `'` inside a
 * single-quoted string (close quote, literal quote, reopen quote). */
function unescapeBashQuotes(text: string): string {
  return text.replace(/'"'"'/g, "'");
}

function extractBetween(text: string, startAnchor: string, endAnchor: string): string {
  const startIdx = text.indexOf(startAnchor);
  if (startIdx === -1) throw new Error(`anchor not found: ${JSON.stringify(startAnchor)}`);
  const bodyStart = startIdx + startAnchor.length;
  const endIdx = text.indexOf(endAnchor, bodyStart);
  if (endIdx === -1) throw new Error(`end anchor not found: ${JSON.stringify(endAnchor)}`);
  return text.slice(bodyStart, endIdx);
}

/** The precondition DO block's body (0057: `DO $$ BEGIN ... END $$;` — the
 * FIRST such block in the file, before merge_plan/merge_group/pre_counts
 * are created; there is a SECOND, unrelated DO block later in 0057 for the
 * post-migration verification, which this must not pick up). */
function extractMigrationPreconditionBody(sql: string): string {
  return extractBetween(sql, 'DO $$\nBEGIN\n', '\nEND $$;');
}

/** The preflight script's own precondition DO block body (delimiter
 * `$PREFLIGHT$` instead of `$$`, and single quotes bash-escaped since the
 * whole SQL blob is itself a bash single-quoted string). */
function extractPreflightPreconditionBody(script: string): string {
  const raw = extractBetween(script, 'DO $PREFLIGHT$\nBEGIN\n', '\nEND $PREFLIGHT$;');
  return unescapeBashQuotes(raw);
}

/** The pre_counts formula: the three count expressions (pre_count,
 * merged_away_count, new_insert_count), independent of how each file wraps
 * them (0057: `CREATE TEMP TABLE pre_counts ... AS SELECT ...;` — not legal
 * in a read-only transaction; preflight: `pre_counts AS (SELECT ...)`, a
 * plain CTE). */
function extractCountFormula(text: string): string {
  const start = '(SELECT count(*) FROM career_target_requirements) AS pre_count,';
  const startIdx = text.indexOf(start);
  if (startIdx === -1) throw new Error('pre_count anchor not found');
  const endAnchor = 'AS new_insert_count';
  const endIdx = text.indexOf(endAnchor, startIdx);
  if (endIdx === -1) throw new Error('new_insert_count anchor not found');
  return text.slice(startIdx, endIdx + endAnchor.length);
}

describe('p0b-preflight.sh is pinned to drizzle/0057_competency_catalog_p0b.sql (n3, final review)', () => {
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
  const preflightScript = readFileSync(PREFLIGHT_PATH, 'utf8');

  it('the precondition DO-block body is textually identical (normalized) in both files', () => {
    const fromMigration = normalizeSql(extractMigrationPreconditionBody(migrationSql));
    const fromPreflight = normalizeSql(extractPreflightPreconditionBody(preflightScript));

    // Sanity: make sure we actually captured non-trivial content, not an
    // empty string from a silently-wrong anchor.
    expect(fromMigration.length).toBeGreaterThan(200);
    expect(fromPreflight).toEqual(fromMigration);
  });

  it('the pre_counts count formula (pre_count/merged_away_count/new_insert_count) is textually identical (normalized) in both files', () => {
    const fromMigration = normalizeSql(extractCountFormula(migrationSql));
    const fromPreflight = normalizeSql(unescapeBashQuotes(extractCountFormula(preflightScript)));

    expect(fromMigration.length).toBeGreaterThan(100);
    expect(fromPreflight).toEqual(fromMigration);
  });
});
