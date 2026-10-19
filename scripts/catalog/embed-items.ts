#!/usr/bin/env tsx
/**
 * P2 Task 6 — embedding cache CLI. Embeds every confirmed bundle card, every
 * O*NET element definition (kind onet_element; migration 0061), plus
 * every O*NET task-statement group (de-duplicated by normalized text, see
 * lib/catalog/shortlist.ts), skipping anything already cached in
 * item_embeddings at the current text hash. See
 * docs/superpowers/sdd/2026-10-13-competency-catalog-p2/task-6-brief.md and
 * docs/superpowers/plans/2026-10-13-competency-catalog-p2.md.
 *
 * Usage (from the repo root, with DATABASE_URL set explicitly — never read
 * from .env.local by hand; get a scratch URL via
 * scripts/migrations/p2-scratch-db.sh url):
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/catalog/embed-items.ts --expect-db gc_curriculum_p2_scratch
 *       # default: dry run — prints item counts by kind and how many are
 *       # already cached at the current text hash. Calls nothing (no AI
 *       # requests, no writes).
 *
 *   ... --apply --expect-db gc_curriculum_p2_scratch [--release 31.0]
 *       # embeds every item missing from item_embeddings via embedBatch,
 *       # then prints {cached, embedded}. Each insert batch is its own
 *       # statement — a crash mid-run leaves only complete rows, and a
 *       # rerun embeds the rest.
 *
 * Safety discipline:
 *   - --expect-db is REQUIRED; assertExpectedDb runs before any other read.
 *   - Refuses (exit 3) before any embedding call if any active bundle lacks
 *     a confirmed card — run draft-bundle-cards --apply first.
 *   - Never prints DATABASE_URL or any other credential.
 */
import { db } from '@/lib/db/client';
import { itemEmbeddings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb, type P1Executor } from '@/scripts/catalog/catalog-source';
import { textHash, cardEmbedText } from '@/lib/catalog/bundles';
import { groupTasks } from '@/lib/catalog/shortlist';
import { elementEmbedText } from '@/lib/catalog/blind-list';
import { listActiveBundles, readConfirmedCards, readTaskStatements, readElementDefinitions, embedMissing, type EmbedItem } from '@/lib/db/bundle-queries';
import { embedBatch, DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';

export type Executor = P1Executor;

export { assertExpectedDb };

const DEFAULT_RELEASE = '31.0';

// ─── CLI args ───────────────────────────────────────────────────────────────

export type Mode = 'dry-run' | 'apply';

export interface EmbedArgs {
  mode: Mode;
  expectDb: string;
  release: string;
}

function argValueFrom(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Throws on missing --expect-db. */
export function parseArgs(argv: string[]): EmbedArgs {
  const expectDb = argValueFrom(argv, '--expect-db');
  if (!expectDb) {
    throw new Error('usage: --expect-db <name> [--release 31.0] [--apply]');
  }
  const release = argValueFrom(argv, '--release') ?? DEFAULT_RELEASE;
  return { mode: argv.includes('--apply') ? 'apply' : 'dry-run', expectDb, release };
}

// ─── Item building ──────────────────────────────────────────────────────────

/** Refuses (throws) if any active bundle lacks a confirmed card. */
async function buildItems(executor: Executor, release: string): Promise<EmbedItem[]> {
  const bundles = await listActiveBundles(executor);
  const confirmed = await readConfirmedCards(executor);
  for (const bundle of bundles) {
    if (!confirmed.has(bundle.id)) {
      throw new Error('no confirmed cards — run draft-bundle-cards --apply first');
    }
  }

  const cardItems: EmbedItem[] = bundles.map(bundle => ({
    kind: 'bundle_card' as const,
    ref: bundle.id,
    text: cardEmbedText(bundle, confirmed.get(bundle.id)!),
  }));

  const taskRows = await readTaskStatements(release, executor);
  const taskItems: EmbedItem[] = groupTasks(taskRows).map(group => ({
    kind: 'onet_task' as const,
    ref: group.key,
    text: group.label,
  }));

  // Blind list (decision 2026-10-19): O*NET element definitions, so the blind
  // panel can shortlist the 20 elements nearest a bundle's card. ref = element_id.
  const elementItems: EmbedItem[] = (await readElementDefinitions(release, executor)).map(def => ({
    kind: 'onet_element' as const,
    ref: def.elementId,
    text: elementEmbedText(def),
  }));

  return [...cardItems, ...taskItems, ...elementItems];
}

/** How many of `items` already have a row in item_embeddings at their current text hash — a read-only count, used only for the dry-run report. */
async function countCached(executor: Executor, items: EmbedItem[], model: string): Promise<number> {
  const existing = await executor.select({ kind: itemEmbeddings.kind, ref: itemEmbeddings.ref, textHash: itemEmbeddings.textHash })
    .from(itemEmbeddings).where(eq(itemEmbeddings.model, model));
  const have = new Set(existing.map(r => `${r.kind}|${r.ref}|${r.textHash}`));
  return items.filter(i => have.has(`${i.kind}|${i.ref}|${textHash(i.text)}`)).length;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface CliDeps {
  executor?: Executor;
  embedMissing?: typeof embedMissing;
  embed?: (texts: string[]) => Promise<number[][]>;
}

/**
 * Returns an exit code rather than calling process.exit itself, so tests
 * can call this directly. Order: parse args -> assertExpectedDb (the ONLY
 * db-identity check, before any other read) -> build items (refuses if any
 * active bundle lacks a confirmed card) -> mode-specific work.
 * Exit codes follow scripts/catalog/draft-bundle-cards.ts's convention:
 * 2 = bad args, 1 = wrong database, 3 = a refusal before any embedding call.
 */
export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  let args: EmbedArgs;
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

  let items: EmbedItem[];
  try {
    items = await buildItems(executor, args.release);
  } catch (err) {
    console.error(formatDbError(err));
    return 3;
  }

  const byKind = { bundle_card: 0, onet_task: 0, onet_element: 0 } as Record<EmbedItem['kind'], number>;
  for (const item of items) byKind[item.kind]++;

  if (args.mode === 'apply') {
    const embedFn = deps.embed ?? ((texts: string[]) => embedBatch(texts));
    const embed = deps.embedMissing ?? embedMissing;
    console.log(`mode: APPLY  expect-db: ${args.expectDb}  release: ${args.release}`);
    console.log(`items: ${byKind.bundle_card} bundle_card, ${byKind.onet_task} onet_task, ${byKind.onet_element} onet_element`);
    const result = await embed(executor, items, DEFAULT_EMBEDDING_MODEL, embedFn);
    console.log(`cached: ${result.cached}  embedded: ${result.embedded}`);
    return 0;
  }

  const cached = await countCached(executor, items, DEFAULT_EMBEDDING_MODEL);
  console.log(`mode: DRY RUN  expect-db: ${args.expectDb}  release: ${args.release}`);
  console.log(`items: ${byKind.bundle_card} bundle_card, ${byKind.onet_task} onet_task, ${byKind.onet_element} onet_element (${items.length} total)`);
  console.log(`already cached at the current text hash: ${cached}`);
  console.log('\nDRY RUN — nothing written, no embedding calls made.');
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
