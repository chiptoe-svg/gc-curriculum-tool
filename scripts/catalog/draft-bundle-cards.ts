#!/usr/bin/env tsx
/**
 * P2 Task 5 — bundle card draft/apply CLI. Drafts, with AI, a card (what a
 * catalog bundle includes/excludes, how it differs from its neighbors,
 * examples, stratum) for owner review, then applies an owner-approved
 * review file into `bundle_cards`. See
 * docs/superpowers/sdd/2026-10-13-competency-catalog-p2/task-5-brief.md and
 * docs/superpowers/plans/2026-10-13-competency-catalog-p2.md Task 5/Ruling 3.
 *
 * Usage (from the repo root, with DATABASE_URL set explicitly — never read
 * from .env.local by hand; get a scratch URL via
 * scripts/migrations/p2-scratch-db.sh url):
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/catalog/draft-bundle-cards.ts --expect-db gc_curriculum_p2_scratch
 *       # default: dry run — lists active bundles, prints a per-bundle
 *       # prompt character count and an estimated cost. Writes nothing.
 *
 *   ... --draft --out <path> --max-cost <usd> [--only id-a,id-b] \
 *       --expect-db gc_curriculum_p2_scratch
 *       # PAID. Drafts a card per active bundle (in id order, or only the
 *       # ids named by --only) and writes the review file to --out.
 *       # Never writes the DB. Stops (exit 4, partial file still written)
 *       # if checkDailyCap() trips or the next bundle's estimate would push
 *       # the running total past --max-cost; re-run with --only for the rest.
 *
 *   ... --apply --file <approved review file> --confirmed-by <name> \
 *       --expect-db gc_curriculum_p2_scratch
 *       # Reads the file, requires a non-empty _approval, and upserts every
 *       # card into bundle_cards as status='confirmed' in one transaction.
 *
 * Safety discipline:
 *   - --expect-db is REQUIRED in every mode; assertExpectedDb runs before
 *     any other read.
 *   - --draft is paid and NEVER writes the DB (review file only).
 *   - --apply NEVER calls the AI provider.
 *   - --draft refuses to overwrite an existing --out file.
 *   - Never prints DATABASE_URL or any other credential.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { db } from '@/lib/db/client';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb, type P1Executor } from '@/scripts/catalog/catalog-source';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { estimateCostCents } from '@/lib/ai/openai';
import { listActiveBundles, upsertConfirmedCards } from '@/lib/db/bundle-queries';
import { draftBundleCard, buildCardUserMessage, BUNDLE_CARD_PROMPT_VERSION } from '@/lib/ai/catalog/draft-bundle-card';
import { parseCardsReviewFile, type ReviewCard, type CardsReviewFile } from '@/lib/catalog/bundles';

export type Executor = P1Executor;

export { assertExpectedDb };

// Fixed completion-token estimate for the dry-run/draft cost estimate: the
// card schema's six fields (includes/excludes/distinctions/2-3 examples
// each) comfortably fit under 1200 completion tokens; this is an estimate
// used only to size --max-cost, never the actual billed amount.
const ESTIMATED_COMPLETION_TOKENS = 1200;

// ─── CLI args ───────────────────────────────────────────────────────────────

export type Mode = 'dry-run' | 'draft' | 'apply';

export interface DraftArgs {
  mode: Mode;
  expectDb: string;
  out?: string;
  maxCostCents?: number;
  only?: string[];
  file?: string;
  confirmedBy?: string;
}

function argValueFrom(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Throws on missing --expect-db, on --draft and --apply together, or on a mode missing its required flags. */
export function parseArgs(argv: string[]): DraftArgs {
  const expectDb = argValueFrom(argv, '--expect-db');
  if (!expectDb) {
    throw new Error('usage: --expect-db <name> [--draft --out <path> --max-cost <usd> [--only a,b]] | [--apply --file <path> --confirmed-by <name>]');
  }

  const draft = argv.includes('--draft');
  const apply = argv.includes('--apply');
  if (draft && apply) throw new Error('usage: --draft and --apply are mutually exclusive');

  if (apply) {
    const file = argValueFrom(argv, '--file');
    const confirmedBy = argValueFrom(argv, '--confirmed-by');
    if (!file || !confirmedBy) throw new Error('usage: --apply requires --file <path> and --confirmed-by <name>');
    return { mode: 'apply', expectDb, file, confirmedBy };
  }

  if (draft) {
    const out = argValueFrom(argv, '--out');
    const maxCostRaw = argValueFrom(argv, '--max-cost');
    if (!out || !maxCostRaw) throw new Error('usage: --draft requires --out <path> and --max-cost <usd>');
    const maxCostUsd = Number(maxCostRaw);
    if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) throw new Error('usage: --max-cost must be a positive number of dollars');
    const onlyRaw = argValueFrom(argv, '--only');
    const only = onlyRaw ? onlyRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    return { mode: 'draft', expectDb, out, maxCostCents: Math.round(maxCostUsd * 10000), only };
  }

  return { mode: 'dry-run', expectDb };
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface CliDeps {
  executor?: Executor;
  listActiveBundles?: typeof listActiveBundles;
  upsertConfirmedCards?: typeof upsertConfirmedCards;
  draftBundleCard?: typeof draftBundleCard;
  checkDailyCap?: typeof checkDailyCap;
  recordSpend?: typeof recordSpend;
}

/**
 * Returns an exit code rather than calling process.exit itself, so tests can
 * call this directly. Order (every mode): parse args -> assertExpectedDb
 * (the ONLY db-identity check, before any other read) -> mode-specific work.
 * Exit codes follow scripts/catalog/insert-business-acumen.ts's convention:
 * 2 = bad args, 1 = wrong database, 3 = a read/parse/refusal before any
 * write, 4 = a write-phase failure or an early stop (draft mode) that still
 * wrote its partial review file.
 */
export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  let args: DraftArgs;
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

  const listBundles = deps.listActiveBundles ?? listActiveBundles;

  if (args.mode === 'apply') {
    return runApply(args, executor, listBundles, deps.upsertConfirmedCards ?? upsertConfirmedCards);
  }

  if (args.mode === 'draft') {
    return runDraft(args, executor, listBundles, deps);
  }

  return runDryRun(args, executor, listBundles);
}

async function runApply(
  args: DraftArgs,
  executor: Executor,
  listBundles: typeof listActiveBundles,
  upsert: typeof upsertConfirmedCards,
): Promise<number> {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(args.file as string, 'utf8'));
  } catch (err) {
    console.error(formatDbError(err));
    return 3;
  }

  let reviewFile: CardsReviewFile;
  try {
    const activeIds = new Set((await listBundles(executor)).map(b => b.id));
    reviewFile = parseCardsReviewFile(json, activeIds, { requireApproval: true });
  } catch (err) {
    console.error(formatDbError(err));
    return 3;
  }

  console.log(`mode: APPLY  expect-db: ${args.expectDb}  file: ${args.file}`);
  console.log(`approval: ${reviewFile._approval}`);
  console.log(`${reviewFile.cards.length} card(s) to apply`);

  try {
    const result = executor === db
      ? await db.transaction(async (tx) => upsert(tx, reviewFile.cards, args.confirmedBy as string))
      : await upsert(executor, reviewFile.cards, args.confirmedBy as string);
    console.log(`applied — inserted ${result.inserted}, updated ${result.updated}`);
  } catch (err) {
    console.error(formatDbError(err));
    return 4;
  }

  return 0;
}

/** Shared by dry-run and draft: the per-bundle prompt (system + user message) and its estimated cost. */
async function promptAndEstimate(bundle: Parameters<typeof buildCardUserMessage>[0], catalog: Parameters<typeof buildCardUserMessage>[1], model: string, systemPrompt: string) {
  const userMessage = buildCardUserMessage(bundle, catalog);
  const chars = systemPrompt.length + userMessage.length;
  const estimateCents = estimateCostCents(model, Math.ceil(chars / 4), ESTIMATED_COMPLETION_TOKENS);
  return { chars, estimateCents };
}

async function runDryRun(args: DraftArgs, executor: Executor, listBundles: typeof listActiveBundles): Promise<number> {
  const catalog = await listBundles(executor);
  const provider = await getProviderForFunction('bundle-card-draft');
  const systemPrompt = await loadPrompt('bundle-card-draft');

  console.log(`mode: DRY RUN  expect-db: ${args.expectDb}`);
  console.log(`${catalog.length} active bundle(s)`);

  let totalEstimateCents = 0;
  for (const bundle of catalog) {
    const { chars, estimateCents } = await promptAndEstimate(bundle, catalog, provider.model, systemPrompt);
    totalEstimateCents += estimateCents;
    console.log(`  - ${bundle.id}: ${chars} prompt chars, ~${estimateCents} (1/100-cent units) at ${provider.model}`);
  }
  console.log(`estimated total cost: ${totalEstimateCents} (1/100-cent units) at ${provider.model}`);
  console.log('\nDRY RUN — nothing written.');
  return 0;
}

async function runDraft(args: DraftArgs, executor: Executor, listBundles: typeof listActiveBundles, deps: CliDeps): Promise<number> {
  const out = args.out as string;
  if (existsSync(out)) {
    console.error(`refusing: --out '${out}' already exists — no overwrite`);
    return 3;
  }

  const catalog = await listBundles(executor);
  const bundles = args.only ? catalog.filter(b => (args.only as string[]).includes(b.id)) : catalog;

  const checkCap = deps.checkDailyCap ?? checkDailyCap;
  const recordSp = deps.recordSpend ?? recordSpend;
  const draft = deps.draftBundleCard ?? draftBundleCard;

  const provider = await getProviderForFunction('bundle-card-draft');
  const systemPrompt = await loadPrompt('bundle-card-draft');

  const cards: ReviewCard[] = [];
  let total = 0;
  let model = provider.model;
  let stopped = false;

  for (const bundle of bundles) {
    const cap = await checkCap();
    if (!cap.ok) {
      console.error(`stopped: daily cost cap reached before drafting '${bundle.id}'`);
      stopped = true;
      break;
    }

    const { estimateCents } = await promptAndEstimate(bundle, catalog, model, systemPrompt);
    if (total + estimateCents > (args.maxCostCents as number)) {
      console.error(`stopped at --max-cost before drafting '${bundle.id}'`);
      stopped = true;
      break;
    }

    const result = await draft(bundle, catalog);
    model = result.model;
    total += result.costUsdCents;
    await recordSp(result.costUsdCents);
    cards.push({ competencyId: bundle.id, name: bundle.name, ...result.card });
  }

  const reviewFile: CardsReviewFile = {
    _approval: '',
    drafted: { model, promptVersion: BUNDLE_CARD_PROMPT_VERSION, at: new Date().toISOString(), costUsdCents: total },
    cards,
  };
  writeFileSync(out, JSON.stringify(reviewFile, null, 2));
  console.log(`wrote ${cards.length} drafted card(s) to ${out} (cost ${total} 1/100-cent units)`);

  if (stopped) {
    console.error('run stopped early — the review file above has only the cards drafted so far; re-run with --only <remaining ids> for the rest');
    return 4;
  }
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
