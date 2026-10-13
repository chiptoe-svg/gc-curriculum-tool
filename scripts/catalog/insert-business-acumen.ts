#!/usr/bin/env tsx
/**
 * P1 Task 5 — owner-gated insert of the four owner-approved business-acumen
 * competencies into the catalog. They enter UNLINKED (no
 * career_target_requirements rows) with origin = 'gc_authored' — see
 * docs/superpowers/specs/2026-10-12-business-acumen-competencies.json (the
 * approved spec: { _approval, competencies: [{ id, name, knowDescriptor,
 * understandDescriptor, doDescriptor, rationale }] }) and
 * docs/superpowers/plans/2026-10-12-competency-catalog-p1.md Task 5.
 *
 * `rationale` is documentation-only (the spec's own record of why each
 * competency was drafted); there is no catalog column for it and it is
 * never written to the DB.
 *
 * Besides the sub_competencies row, every insert also adds the identity
 * sub_competency_map row (old = new id, merge_note = null) that the 0057
 * verify invariant requires (count(sub_competency_map) ==
 * count(sub_competencies)) — see competency-catalog-queries.ts and
 * lib/db/schema.ts's sub_competency_map doc comment.
 *
 * Usage (from the repo root, with DATABASE_URL set explicitly — never read
 * from .env.local by hand; get a scratch URL via
 * scripts/migrations/p1-scratch-db.sh url):
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/catalog/insert-business-acumen.ts \
 *     --file /Users/admin/projects/curriculum_developer/docs/superpowers/specs/2026-10-12-business-acumen-competencies.json \
 *     --expect-db gc_curriculum_p1_scratch            # default: dry run, writes nothing
 *     ... --apply --expect-db gc_curriculum_p1_scratch # inserts the 4 rows
 *
 * Safety discipline:
 *   - --expect-db is REQUIRED; assertExpectedDb (imported from
 *     scripts/careers/ingest-alumni-mix.ts — the one DB-identity check
 *     every P1 write script reuses) runs before any other read.
 *   - --dry-run is the default (no --apply flag needed): it reads and
 *     validates the spec file and prints what would be inserted. It writes
 *     nothing.
 *   - --apply inserts in ONE transaction, after re-checking that none of
 *     the 4 ids already exist in sub_competencies (refuses — writes
 *     nothing — if any do; no silent overwrite).
 *   - Never prints DATABASE_URL or any other credential.
 */
import { readFileSync } from 'node:fs';
import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies, subCompetencyMap } from '@/lib/db/schema';
import { loadAppEnv, isMainModule } from '@/scripts/catalog/catalog-source';
import { assertExpectedDb } from '@/scripts/careers/ingest-alumni-mix';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

export { assertExpectedDb };

// ─── CLI args ───────────────────────────────────────────────────────────────

export interface InsertArgs {
  file: string;
  expectDb: string;
  apply: boolean;
}

function argValueFrom(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Throws if --file or --expect-db is missing. */
export function parseArgs(argv: string[]): InsertArgs {
  const file = argValueFrom(argv, '--file');
  const expectDb = argValueFrom(argv, '--expect-db');
  if (!file || !expectDb) {
    throw new Error('usage: --file <business-acumen-competencies.json> --expect-db <name> [--apply]');
  }
  return { file, expectDb, apply: argv.includes('--apply') };
}

// ─── Spec parsing + validation ─────────────────────────────────────────────

export interface BusinessAcumenEntry {
  id: string;
  name: string;
  knowDescriptor: string;
  understandDescriptor: string;
  doDescriptor: string;
  rationale: string;
}

export interface BusinessAcumenSpec {
  approval: string;
  competencies: BusinessAcumenEntry[];
}

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REQUIRED_STRING_FIELDS = ['id', 'name', 'knowDescriptor', 'understandDescriptor', 'doDescriptor', 'rationale'] as const;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Throws with a descriptive message on any structural or field problem. Never silently coerces. */
export function validateEntry(entry: unknown, index: number): BusinessAcumenEntry {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error(`competencies[${index}]: not an object`);
  }
  const e = entry as Record<string, unknown>;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(e[field])) {
      throw new Error(`competencies[${index}]: missing or empty required field '${field}'`);
    }
  }
  const id = e.id as string;
  if (!ID_PATTERN.test(id)) {
    throw new Error(`competencies[${index}]: id '${id}' is not lowercase-kebab-case`);
  }
  return {
    id,
    name: e.name as string,
    knowDescriptor: e.knowDescriptor as string,
    understandDescriptor: e.understandDescriptor as string,
    doDescriptor: e.doDescriptor as string,
    rationale: e.rationale as string,
  };
}

/** Throws on a malformed top-level shape, a malformed entry, or a duplicate id within the file. */
export function parseSpec(json: unknown): BusinessAcumenSpec {
  if (typeof json !== 'object' || json === null) {
    throw new Error('spec: not an object');
  }
  const root = json as Record<string, unknown>;
  if (!isNonEmptyString(root._approval)) {
    throw new Error('spec: missing or empty _approval');
  }
  if (!Array.isArray(root.competencies) || root.competencies.length === 0) {
    throw new Error('spec: competencies must be a non-empty array');
  }
  const competencies = root.competencies.map((e, i) => validateEntry(e, i));
  const seen = new Set<string>();
  for (const c of competencies) {
    if (seen.has(c.id)) throw new Error(`spec: duplicate id '${c.id}' within the file`);
    seen.add(c.id);
  }
  return { approval: root._approval as string, competencies };
}

export function loadSpecJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

// ─── Write (insert-only; no overwrite, no membership, unlinked) ───────────

/**
 * Inserts each entry into sub_competencies (origin = 'gc_authored',
 * retired = false, mergedInto null — unlinked: no career_target_requirements
 * row is written) plus its identity sub_competency_map row. Refuses — writes
 * nothing — if any id already exists in sub_competencies (no silent
 * overwrite); the existing-id check and both inserts run against the same
 * `executor`, so a caller passing a transaction gets this atomically.
 */
export async function insertBusinessAcumen(executor: Executor, entries: BusinessAcumenEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const ids = entries.map(e => e.id);
  const existing = await executor.select({ id: subCompetencies.id }).from(subCompetencies).where(inArray(subCompetencies.id, ids));
  if (existing.length > 0) {
    const existingIds = existing.map(r => r.id).sort();
    throw new Error(`refusing: id(s) already exist in sub_competencies: ${existingIds.join(', ')} — no overwrite`);
  }
  await executor.insert(subCompetencies).values(
    entries.map(e => ({
      id: e.id,
      name: e.name,
      knowDescriptor: e.knowDescriptor,
      understandDescriptor: e.understandDescriptor,
      doDescriptor: e.doDescriptor,
      retired: false,
      mergedInto: null,
      origin: 'gc_authored' as const,
      updatedAt: new Date(),
    })),
  );
  await executor.insert(subCompetencyMap).values(
    entries.map(e => ({
      oldSubCompetencyId: e.id,
      competencyId: e.id,
      mergeNote: null,
    })),
  );
}

// ─── Report ─────────────────────────────────────────────────────────────────

export function printReport(args: InsertArgs, spec: BusinessAcumenSpec): void {
  console.log(`mode: ${args.apply ? 'APPLY' : 'DRY RUN'}  expect-db: ${args.expectDb}  file: ${args.file}`);
  console.log(`approval: ${spec.approval}`);
  console.log(`${spec.competencies.length} competency(ies) to insert (unlinked, origin=gc_authored):`);
  for (const c of spec.competencies) console.log(`  - ${c.id} (${c.name})`);
  console.log(args.apply ? '\nAPPLY — rows inserted.' : '\nDRY RUN — nothing written.');
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface InsertDeps {
  executor?: Executor;
  loadSpecJson?: typeof loadSpecJson;
  insertBusinessAcumen?: typeof insertBusinessAcumen;
}

/**
 * Returns an exit code rather than calling process.exit itself, so tests can
 * call this directly. Order: parse args -> assertExpectedDb (the ONLY
 * db-identity check, before any other read) -> read + validate the spec ->
 * report -> (if --apply) insert in one transaction.
 */
export async function main(argv: string[], deps: InsertDeps = {}): Promise<number> {
  let args: InsertArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const executor = deps.executor ?? db;
  try {
    await assertExpectedDb(args.expectDb, executor);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const loadJson = deps.loadSpecJson ?? loadSpecJson;
  let spec: BusinessAcumenSpec;
  try {
    const json = loadJson(args.file);
    spec = parseSpec(json);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 3;
  }

  printReport(args, spec);

  if (!args.apply) {
    return 0;
  }

  const write = deps.insertBusinessAcumen ?? insertBusinessAcumen;
  try {
    if (executor === db) {
      await db.transaction(async (tx) => {
        await write(tx, spec.competencies);
      });
    } else {
      // Already inside a transaction the caller controls (tests).
      await write(executor, spec.competencies);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 4;
  }

  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
