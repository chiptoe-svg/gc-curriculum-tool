#!/usr/bin/env tsx
/**
 * P2 Task 7 — seeded stratified golden-sample draw CLI. Draws GOLDEN_SIZE
 * (8) bundles across the 4 strata (Ruling 3 quotas), and for each sampled
 * bundle computes + stores its top-50 task-group shortlist by cosine
 * similarity (Ruling 4: fixed at draw time, so the reviewer's universe and
 * the later AI top-25 refer to the same ranking). See
 * docs/superpowers/sdd/2026-10-13-competency-catalog-p2/task-7-brief.md and
 * docs/superpowers/plans/2026-10-13-competency-catalog-p2.md Task 7.
 *
 * Usage (from the repo root, with DATABASE_URL set explicitly — never read
 * from .env.local by hand; get a scratch URL via
 * scripts/migrations/p2-scratch-db.sh url):
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/catalog/draw-golden-sample.ts --seed <text> \
 *     --expect-db gc_curriculum_p2_scratch [--release 31.0]
 *       # default: dry run — draws the 8 ids, prints each one's stratum
 *       # and its top-5 candidate labels. Writes nothing.
 *
 *   ... --apply --seed <text> --expect-db gc_curriculum_p2_scratch
 *       # inserts the 8 rows into bundle_golden_samples in one transaction.
 *
 *   ... --apply --replace --seed <text> --expect-db gc_curriculum_p2_scratch
 *       # redraws: deletes the existing (unsubmitted) sample rows, then
 *       # inserts the new draw, in one transaction.
 *
 * Safety discipline:
 *   - --expect-db is REQUIRED; assertExpectedDb runs before any other read.
 *   - Refuses (exit 3) if any active bundle lacks a confirmed card, or if
 *     the card vector or any O*NET task-group vector is missing — run
 *     embed-items --apply first.
 *   - Refuses (exit 3) if bundle_golden_samples already has rows and
 *     --replace was not given.
 *   - --replace refuses (exit 5) if any existing sample has submitted_at
 *     set: a submitted blind pick is never redrawn.
 *   - --replace also refuses (exit 5) once ANY bundle has an `ok` mapping
 *     outcome — the reviewer may already have seen placements, so a redrawn
 *     bundle would not be blind — and if any sample carries a reset_note
 *     (that audit trail is never deleted).
 *   - Never prints DATABASE_URL or any other credential.
 */
import { eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { bundleGoldenSamples, bundleMappingOutcomes, type BundleStratum, type GoldenCandidate } from '@/lib/db/schema';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb, type P1Executor } from '@/scripts/catalog/catalog-source';
import { cardEmbedText, drawGoldenSample, type BundleSummary, type CardFields } from '@/lib/catalog/bundles';
import { groupTasks, shortlistTasks } from '@/lib/catalog/shortlist';
import {
  listActiveBundles,
  readConfirmedCards,
  readTaskStatements,
  readVectors,
  insertGoldenSamples,
} from '@/lib/db/bundle-queries';
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';

export type Executor = P1Executor;

export { assertExpectedDb };

const DEFAULT_RELEASE = '31.0';
const SHORTLIST_SIZE = 50;
const PREVIEW_SIZE = 5;

// ─── CLI args ───────────────────────────────────────────────────────────────

export interface DrawArgs {
  seed: string;
  expectDb: string;
  release: string;
  apply: boolean;
  replace: boolean;
}

function argValueFrom(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Throws on missing --seed or --expect-db. */
export function parseArgs(argv: string[]): DrawArgs {
  const seed = argValueFrom(argv, '--seed');
  const expectDb = argValueFrom(argv, '--expect-db');
  if (!seed || !expectDb) {
    throw new Error('usage: --seed <text> --expect-db <name> [--release 31.0] [--apply] [--replace]');
  }
  const release = argValueFrom(argv, '--release') ?? DEFAULT_RELEASE;
  return { seed, expectDb, release, apply: argv.includes('--apply'), replace: argv.includes('--replace') };
}

// ─── Candidate building ────────────────────────────────────────────────────

export interface SampleRow { bundleId: string; stratum: BundleStratum; seed: string; candidates: GoldenCandidate[] }

/**
 * Draws GOLDEN_SIZE bundles and computes each one's top-50 task-group
 * shortlist. Throws (caller maps to exit 3) if a card or task-group vector
 * is missing — a missing/mismatched vector must surface as a clear error,
 * never a silent skip (Task 6 review note).
 */
async function buildSampleRows(
  executor: Executor,
  seed: string,
  release: string,
  deps: {
    listActiveBundles: typeof listActiveBundles;
    readConfirmedCards: typeof readConfirmedCards;
    readTaskStatements: typeof readTaskStatements;
    readVectors: typeof readVectors;
  },
): Promise<SampleRow[]> {
  const bundles = await deps.listActiveBundles(executor);
  const confirmed = await deps.readConfirmedCards(executor);
  for (const b of bundles) {
    if (!confirmed.has(b.id)) {
      throw new Error(`no confirmed card for '${b.id}' — run draft-bundle-cards --apply first`);
    }
  }

  const bundleById = new Map(bundles.map(b => [b.id, b]));
  const drawn = drawGoldenSample(bundles.map(b => ({ id: b.id, stratum: confirmed.get(b.id)!.stratum })), seed);

  const taskRows = await deps.readTaskStatements(release, executor);
  const groups = groupTasks(taskRows);
  const taskVectors = await deps.readVectors(executor, 'onet_task', groups.map(g => ({ ref: g.key, text: g.label })), DEFAULT_EMBEDDING_MODEL);
  const missingGroups = groups.filter(g => !taskVectors.has(g.key));
  if (missingGroups.length > 0) {
    throw new Error(`missing task-group vector(s) for ${missingGroups.length} group(s) (e.g. '${missingGroups[0]!.key}') — run embed-items --apply first`);
  }
  const groupByKey = new Map(groups.map(g => [g.key, g]));

  const rows: SampleRow[] = [];
  for (const d of drawn) {
    const bundle = bundleById.get(d.id) as BundleSummary;
    const card = confirmed.get(d.id) as CardFields;
    const cardText = cardEmbedText(bundle, card);
    const cardVectors = await deps.readVectors(executor, 'bundle_card', [{ ref: d.id, text: cardText }], DEFAULT_EMBEDDING_MODEL);
    const cardVector = cardVectors.get(d.id);
    if (!cardVector) {
      throw new Error(`missing bundle_card vector for '${d.id}' — run embed-items --apply first`);
    }

    const entries = shortlistTasks(cardVector, taskVectors, SHORTLIST_SIZE);
    const candidates: GoldenCandidate[] = entries.map(e => {
      const g = groupByKey.get(e.key)!;
      return { key: e.key, label: g.label, rank: e.rank, score: e.score, members: g.members };
    });
    rows.push({ bundleId: d.id, stratum: d.stratum, seed, candidates });
  }
  return rows;
}

// ─── Report ─────────────────────────────────────────────────────────────────

function printRows(mode: string, args: DrawArgs, rows: SampleRow[]): void {
  console.log(`mode: ${mode}  expect-db: ${args.expectDb}  seed: ${args.seed}  release: ${args.release}`);
  console.log(`drawn ${rows.length} bundle(s):`);
  for (const r of rows) {
    console.log(`  - ${r.bundleId} (${r.stratum})`);
    for (const c of r.candidates.slice(0, PREVIEW_SIZE)) {
      console.log(`      ${c.rank}. ${c.label} (${c.score.toFixed(4)})`);
    }
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface CliDeps {
  executor?: Executor;
  listActiveBundles?: typeof listActiveBundles;
  readConfirmedCards?: typeof readConfirmedCards;
  readTaskStatements?: typeof readTaskStatements;
  readVectors?: typeof readVectors;
  insertGoldenSamples?: typeof insertGoldenSamples;
}

/**
 * Returns an exit code rather than calling process.exit itself, so tests
 * can call this directly. Order: parse args -> assertExpectedDb (the ONLY
 * db-identity check, before any other read) -> existing-sample refusal
 * check -> build the draw + shortlists (refuses exit 3 on any missing
 * confirmed card or vector) -> report -> (if --apply) write in one
 * transaction. Exit codes follow scripts/catalog/draft-bundle-cards.ts's
 * convention: 2 = bad args, 1 = wrong database, 3 = a refusal before any
 * write, 4 = a write-phase failure, 5 = --replace blocked by an already-
 * submitted sample (brief-specified, distinct from the generic 3).
 */
export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  let args: DrawArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(formatDbError(err));
    return 2;
  }

  const executor = deps.executor ?? db;
  try {
    await assertExpectedDb(args.expectDb, executor);
  } catch (err) {
    console.error(formatDbError(err));
    return 1;
  }

  let existing: Array<{ bundleId: string; submittedAt: Date | null; resetNote: string | null }>;
  let mappedCount: number;
  try {
    existing = await executor.select({ bundleId: bundleGoldenSamples.bundleId, submittedAt: bundleGoldenSamples.submittedAt, resetNote: bundleGoldenSamples.resetNote }).from(bundleGoldenSamples);
    mappedCount = (await executor.selectDistinct({ id: bundleMappingOutcomes.bundleId }).from(bundleMappingOutcomes)
      .where(eq(bundleMappingOutcomes.status, 'ok'))).length;
  } catch (err) {
    console.error(formatDbError(err));
    return 3;
  }

  if (existing.length > 0 && !args.replace) {
    console.error(`refusing: ${existing.length} golden sample row(s) already exist — pass --replace to redraw`);
    return 3;
  }

  if (args.replace) {
    const submitted = existing.filter(r => r.submittedAt !== null);
    if (submitted.length > 0) {
      console.error(`refusing --replace: sample(s) already submitted for ${submitted.map(r => r.bundleId).join(', ')} — a submitted blind pick is never redrawn`);
      return 5;
    }
    if (mappedCount > 0) {
      console.error(`refusing --replace: ${mappedCount} bundle(s) already have an ok mapping outcome — the reviewer may have seen their placements, so a redraw would not be blind`);
      return 5;
    }
    const withNote = existing.filter(r => r.resetNote !== null);
    if (withNote.length > 0) {
      console.error(`refusing --replace: sample(s) for ${withNote.map(r => r.bundleId).join(', ')} carry reset_note history, which a redraw would delete`);
      return 5;
    }
  }

  let rows: SampleRow[];
  try {
    rows = await buildSampleRows(executor, args.seed, args.release, {
      listActiveBundles: deps.listActiveBundles ?? listActiveBundles,
      readConfirmedCards: deps.readConfirmedCards ?? readConfirmedCards,
      readTaskStatements: deps.readTaskStatements ?? readTaskStatements,
      readVectors: deps.readVectors ?? readVectors,
    });
  } catch (err) {
    console.error(formatDbError(err));
    return 3;
  }

  if (!args.apply) {
    printRows('DRY RUN', args, rows);
    console.log('\nDRY RUN — nothing written.');
    return 0;
  }

  const insert = deps.insertGoldenSamples ?? insertGoldenSamples;
  try {
    if (executor === db) {
      await db.transaction(async (tx) => {
        if (args.replace) await tx.delete(bundleGoldenSamples).where(isNull(bundleGoldenSamples.submittedAt));
        await insert(tx, rows);
      });
    } else {
      // Already inside a transaction the caller controls (tests).
      if (args.replace) await executor.delete(bundleGoldenSamples).where(isNull(bundleGoldenSamples.submittedAt));
      await insert(executor, rows);
    }
  } catch (err) {
    console.error(formatDbError(err));
    return 4;
  }

  printRows('APPLY', args, rows);
  console.log('\nAPPLY — rows inserted.');
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
