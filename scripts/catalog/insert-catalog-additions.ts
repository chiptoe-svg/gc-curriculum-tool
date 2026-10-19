#!/usr/bin/env tsx
/**
 * Owner-gated insert of the 2026-10-19 catalog additions (11 new
 * competencies) plus two descriptor revisions — see
 * docs/superpowers/specs/2026-10-19-catalog-additions.json.
 *
 * New competencies enter UNLINKED (no career_target_requirements rows) with
 * origin = 'gc_authored', plus the identity sub_competency_map row (old = new,
 * merge_note null) like insert-business-acumen.ts. `foundational` entries are
 * D-only: K/U descriptors are null (migration 0060 CHECK). `stratum`,
 * `rationale` and `derivedFrom` are documentation/card grouping only and are
 * never written to sub_competencies.
 *
 * Revisions update the three descriptors of an existing row, but only when the
 * row's current text equals the file's prior* text (otherwise refuse, printing
 * both texts).
 *
 * Usage (DATABASE_URL set explicitly; scratch URL via
 * scripts/migrations/ca-scratch-db.sh url):
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/catalog/insert-catalog-additions.ts --file <abs path> \
 *     --expect-db gc_curriculum_ca_scratch [--apply]   # default: dry run
 *
 * Dry run (the default) runs the SAME applyAdditions inside a transaction that
 * always rolls back, so refusals (existing id, prior-text drift) are previewed
 * with their full messages before anything is applied.
 *
 * --preflight runs only the read-only checks (no write attempt), using columns
 * that exist before migration 0060, so the runbook can run it BEFORE 0060.
 *
 * Exit codes: 0 ok (dry run: would apply), 1 wrong DB, 2 usage, 3 bad file,
 * 4 apply refused/failed, 5 dry run/preflight: WOULD REFUSE (nothing was written).
 * Never prints DATABASE_URL. One transaction.
 */
import { readFileSync } from 'node:fs';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies, subCompetencyMap } from '@/lib/db/schema';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb } from '@/scripts/catalog/catalog-source';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

export interface Args { file: string; expectDb: string; apply: boolean; preflight: boolean }

export function parseArgs(argv: string[]): Args {
  const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const file = val('--file');
  const expectDb = val('--expect-db');
  if (!file || !expectDb) throw new Error('usage: --file <catalog-additions.json> --expect-db <name> [--apply | --preflight]');
  const apply = argv.includes('--apply');
  const preflight = argv.includes('--preflight');
  if (apply && preflight) throw new Error('--apply and --preflight are mutually exclusive');
  return { file, expectDb, apply, preflight };
}

export interface NewCompetency {
  id: string;
  name: string;
  foundational: boolean;
  scoring: 'direct' | 'derived';
  knowDescriptor: string | null;
  understandDescriptor: string | null;
  doDescriptor: string;
}
export interface DescriptorRevision {
  id: string;
  knowDescriptor: string;
  understandDescriptor: string;
  doDescriptor: string;
  priorKnowDescriptor: string;
  priorUnderstandDescriptor: string;
  priorDoDescriptor: string;
}
export interface Additions {
  approval: string;
  newCompetencies: NewCompetency[];
  descriptorRevisions: DescriptorRevision[];
}

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function obj(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${where}: not an object`);
  return v as Record<string, unknown>;
}

function parseNew(raw: unknown, i: number): NewCompetency {
  const w = `newCompetencies[${i}]`;
  const e = obj(raw, w);
  for (const f of ['id', 'name', 'doDescriptor'] as const) {
    if (!nonEmpty(e[f])) throw new Error(`${w}: missing or empty required field '${f}'`);
  }
  const id = e.id as string;
  if (!ID_PATTERN.test(id)) throw new Error(`${w}: id '${id}' is not lowercase-kebab-case`);
  if (typeof e.foundational !== 'boolean') throw new Error(`${w}: 'foundational' must be a boolean`);
  if (e.scoring !== 'direct' && e.scoring !== 'derived') throw new Error(`${w}: 'scoring' must be 'direct' or 'derived'`);
  const k = e.knowDescriptor;
  const u = e.understandDescriptor;
  if (e.foundational) {
    if (k !== null || u !== null) throw new Error(`${w} (${id}): foundational entry must have null knowDescriptor and understandDescriptor`);
  } else if (!nonEmpty(k) || !nonEmpty(u)) {
    throw new Error(`${w} (${id}): non-foundational entry must have non-empty knowDescriptor and understandDescriptor`);
  }
  return {
    id, name: e.name as string, foundational: e.foundational, scoring: e.scoring,
    knowDescriptor: k as string | null, understandDescriptor: u as string | null, doDescriptor: e.doDescriptor as string,
  };
}

function parseRevision(raw: unknown, i: number): DescriptorRevision {
  const w = `descriptorRevisions[${i}]`;
  const e = obj(raw, w);
  const fields = ['id', 'knowDescriptor', 'understandDescriptor', 'doDescriptor', 'priorKnowDescriptor', 'priorUnderstandDescriptor', 'priorDoDescriptor'] as const;
  for (const f of fields) if (!nonEmpty(e[f])) throw new Error(`${w}: missing or empty required field '${f}'`);
  return Object.fromEntries(fields.map(f => [f, e[f] as string])) as unknown as DescriptorRevision;
}

/** Throws on any structural problem; never coerces. */
export function parseAdditions(json: unknown): Additions {
  const root = obj(json, 'additions');
  if (!nonEmpty(root._approval)) throw new Error('additions: missing or empty _approval');
  if (!Array.isArray(root.newCompetencies)) throw new Error('additions: newCompetencies must be an array');
  const revs = root.descriptorRevisions ?? [];
  if (!Array.isArray(revs)) throw new Error('additions: descriptorRevisions must be an array');
  const newCompetencies = root.newCompetencies.map(parseNew);
  const descriptorRevisions = revs.map(parseRevision);
  const seen = new Set<string>();
  for (const c of newCompetencies) {
    if (seen.has(c.id)) throw new Error(`additions: duplicate id '${c.id}' within newCompetencies`);
    seen.add(c.id);
  }
  return { approval: root._approval as string, newCompetencies, descriptorRevisions };
}

/**
 * Read-only precondition checks: throws if any new id exists or any revision's
 * current DB text differs from its prior* text. Selects only columns that
 * exist BEFORE migration 0060, so it can run as a pre-migration preflight.
 */
export async function checkAdditions(tx: Executor, a: Additions): Promise<void> {
  const ids = a.newCompetencies.map(c => c.id);
  if (ids.length > 0) {
    const existing = await tx.select({ id: subCompetencies.id }).from(subCompetencies).where(inArray(subCompetencies.id, ids));
    if (existing.length > 0) {
      throw new Error(`refusing: id(s) already exist in sub_competencies: ${existing.map(r => r.id).sort().join(', ')} — no overwrite`);
    }
  }
  for (const r of a.descriptorRevisions) {
    const [cur] = await tx.select({ knowDescriptor: subCompetencies.knowDescriptor, understandDescriptor: subCompetencies.understandDescriptor, doDescriptor: subCompetencies.doDescriptor }).from(subCompetencies).where(eq(subCompetencies.id, r.id));
    if (!cur) throw new Error(`refusing: revision target '${r.id}' does not exist`);
    const diffs: string[] = [];
    const check = (label: string, db_: string | null, prior: string) => {
      if (db_ !== prior) diffs.push(`  ${label}\n    DB:    ${JSON.stringify(db_)}\n    prior: ${JSON.stringify(prior)}`);
    };
    check('knowDescriptor', cur.knowDescriptor, r.priorKnowDescriptor);
    check('understandDescriptor', cur.understandDescriptor, r.priorUnderstandDescriptor);
    check('doDescriptor', cur.doDescriptor, r.priorDoDescriptor);
    if (diffs.length > 0) throw new Error(`refusing: current text of '${r.id}' differs from the file's prior* text:\n${diffs.join('\n')}`);
  }
}

/**
 * Inserts the new rows (+ identity map rows) and applies the revisions, all on
 * `tx`, after checkAdditions (which throws, rolling back the caller's
 * transaction).
 */
export async function applyAdditions(tx: Executor, a: Additions): Promise<{ inserted: string[]; revised: string[] }> {
  await checkAdditions(tx, a);
  const ids = a.newCompetencies.map(c => c.id);

  if (a.newCompetencies.length > 0) {
    await tx.insert(subCompetencies).values(a.newCompetencies.map(c => ({
      id: c.id, name: c.name,
      knowDescriptor: c.knowDescriptor, understandDescriptor: c.understandDescriptor, doDescriptor: c.doDescriptor,
      foundational: c.foundational, scoring: c.scoring,
      retired: false, mergedInto: null, origin: 'gc_authored' as const, updatedAt: new Date(),
    })));
    await tx.insert(subCompetencyMap).values(a.newCompetencies.map(c => ({ oldSubCompetencyId: c.id, competencyId: c.id, mergeNote: null })));
  }
  for (const r of a.descriptorRevisions) {
    await tx.update(subCompetencies).set({
      knowDescriptor: r.knowDescriptor, understandDescriptor: r.understandDescriptor, doDescriptor: r.doDescriptor, updatedAt: new Date(),
    }).where(eq(subCompetencies.id, r.id));
  }
  return { inserted: ids, revised: a.descriptorRevisions.map(r => r.id) };
}

export function printReport(args: Args, a: Additions): void {
  console.log(`mode: ${args.apply ? 'APPLY' : args.preflight ? 'PREFLIGHT' : 'DRY RUN'}  expect-db: ${args.expectDb}  file: ${args.file}`);
  console.log(`approval: ${a.approval}`);
  console.log(`${a.newCompetencies.length} competency(ies) to insert (unlinked, origin=gc_authored):`);
  for (const c of a.newCompetencies) console.log(`  - ${c.id} (${c.name}) foundational=${c.foundational} scoring=${c.scoring}`);
  console.log(`${a.descriptorRevisions.length} descriptor revision(s):`);
  for (const r of a.descriptorRevisions) console.log(`  - ${r.id}`);
  console.log(args.apply ? '\nAPPLY — writing.' : args.preflight ? '\nPREFLIGHT — read-only checks.' : '\nDRY RUN — checking inside a rolled-back transaction; nothing written.');
}

export interface Deps {
  executor?: Executor;
  loadJson?: (file: string) => unknown;
  applyAdditions?: typeof applyAdditions;
}

export async function main(argv: string[], deps: Deps = {}): Promise<number> {
  let args: Args;
  try { args = parseArgs(argv); } catch (err) { console.error(formatDbError(err)); return 2; }

  const executor = deps.executor ?? db;
  try { await assertExpectedDb(args.expectDb, executor); } catch (err) { console.error(formatDbError(err)); return 1; }

  let additions: Additions;
  try {
    additions = parseAdditions((deps.loadJson ?? ((f: string) => JSON.parse(readFileSync(f, 'utf8'))))(args.file));
  } catch (err) { console.error(formatDbError(err)); return 3; }

  printReport(args, additions);
  if (args.preflight) {
    try { await checkAdditions(executor, additions); } catch (err) {
      console.error(`PREFLIGHT: WOULD REFUSE — ${formatDbError(err)}`);
      return 5;
    }
    console.log(`PREFLIGHT OK: ${additions.newCompetencies.length} id(s) free, ${additions.descriptorRevisions.length} revision prior-text(s) match (checks only; migration 0060 not required; nothing written).`);
    return 0;
  }
  const write = deps.applyAdditions ?? applyAdditions;

  if (!args.apply) {
    class DryRunRollback extends Error {}
    let res: { inserted: string[]; revised: string[] } | undefined;
    try {
      await (executor as typeof db).transaction(async tx => {
        res = await write(tx, additions);
        throw new DryRunRollback('dry run');
      });
    } catch (err) {
      if (!(err instanceof DryRunRollback)) {
        console.error(`DRY RUN: WOULD REFUSE — ${formatDbError(err)}`);
        return 5;
      }
    }
    console.log(`DRY RUN: would insert ${res?.inserted.length ?? 0}, would revise ${res?.revised.length ?? 0} (rolled back; nothing written).`);
    return 0;
  }

  try {
    let res: { inserted: string[]; revised: string[] };
    if (executor === db) res = await db.transaction(tx => write(tx, additions));
    else res = await write(executor, additions);
    console.log(`inserted ${res.inserted.length}, revised ${res.revised.length}`);
  } catch (err) { console.error(formatDbError(err)); return 4; }
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
