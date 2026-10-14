#!/usr/bin/env tsx
/**
 * P2 Task 10 — the bundle → O*NET mapping run. For each active bundle in
 * scope: shortlist the top-K task groups by cosine against the bundle's card
 * vector, place every loaded element + the shortlist with the
 * bundle-map-onet call (lib/ai/catalog/map-bundle-onet.ts), and write the
 * result with writeBundleProposals — one transaction per bundle; a rerun
 * replaces ONLY rows still `proposed` (confirmed/rejected rows are never
 * touched). See docs/superpowers/plans/2026-10-13-competency-catalog-p2.md
 * Task 10.
 *
 * Usage (from the repo root, with DATABASE_URL set explicitly — get a
 * scratch URL via scripts/migrations/p2-scratch-db.sh url):
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/catalog/map-bundles-onet.ts --expect-db gc_curriculum_p2_scratch \
 *     [--release 31.0] [--missing] [--bundles a,b]
 *       # default: dry run — per bundle prints the element count, the top-5
 *       # shortlisted task labels and the cost estimate; then the total.
 *       # No AI calls, no writes.
 *
 *   ... --apply --max-cost <usd>
 *       # paid run. Stops (exit 4) before a bundle whose estimate would take
 *       # the run's actual spend past --max-cost, or when checkDailyCap()
 *       # refuses; rerun with --missing to continue. A call that fails with
 *       # its cost unknown (non-JSON reply, refusal, schema-validation
 *       # failure) is charged at its estimate — to the run, to recordSpend and
 *       # to the failed outcome — so repeated failures still hit both caps.
 *
 * A sampled bundle whose blind pick is not yet submitted prints only
 * "<id>: sampled — hidden until blind pick" plus its cost/token figures (the
 * operator is also the blind reviewer).
 *
 * Bundles whose blind golden sample is already SUBMITTED are skipped by
 * default (also under --missing / --bundles): re-mapping them would mix two
 * AI runs in their agreement figures. --include-submitted-samples maps them
 * anyway, with a warning.
 *
 * Plan Ruling 4 guard: for every in-scope bundle with a golden sample, the
 * placement shortlist must equal the first TASK_SHORTLIST_K stored
 * candidates (same keys, same order); any mismatch refuses the whole run
 * (exit 3) before any paid call.
 *
 * Exit codes: 0 ok · 1 wrong database, or any bundle failed · 2 bad args
 * (incl. --apply without --max-cost, unknown --bundles id) · 3 refusal before
 * any write (missing card, element definitions, task statements or vectors)
 * · 4 stopped by --max-cost or the daily cap (a failure takes precedence: 1).
 *
 * Never prints DATABASE_URL, prompts or rationale text — summary lines only.
 */
import { db } from '@/lib/db/client';
import { bundleGoldenSamples } from '@/lib/db/schema';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb, type P1Executor } from '@/scripts/catalog/catalog-source';
import { cardEmbedText } from '@/lib/catalog/bundles';
import { groupTasks, shortlistTasks } from '@/lib/catalog/shortlist';
import {
  listActiveBundles, readConfirmedCards, readTaskStatements, readVectors, readElementDefinitions,
  createRun, finishRun, writeBundleProposals, recordFailedOutcome, bundlesWithOkOutcome,
} from '@/lib/db/bundle-queries';
import {
  placeBundle, buildPlacementUserMessage, TASK_SHORTLIST_K, BUNDLE_MAP_PROMPT_VERSION, type PlacementInput,
} from '@/lib/ai/catalog/map-bundle-onet';
import { getProviderForFunction } from '@/lib/ai/provider';
import { estimateCostCents } from '@/lib/ai/openai';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';

export type Executor = P1Executor;

const DEFAULT_RELEASE = '31.0';
const PREVIEW_SIZE = 5;
/** Estimate allowances, in tokens: the system prompt (input) and the placement output. */
const SYSTEM_PROMPT_TOKENS = 1500;
const OUTPUT_TOKENS = 2500;

// ─── CLI args ───────────────────────────────────────────────────────────────

export interface MapArgs {
  expectDb: string;
  release: string;
  apply: boolean;
  maxCostCents: number | null;
  missing: boolean;
  bundles: string[] | null;
  includeSubmittedSamples: boolean;
}

function argValueFrom(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Throws on bad args (caller maps to exit 2). `--max-cost` is dollars, converted once to 1/100-cent units. */
export function parseArgs(argv: string[]): MapArgs {
  const usage = 'usage: --expect-db <name> [--release 31.0] [--apply --max-cost <usd>] [--missing] [--bundles a,b] [--include-submitted-samples]';
  const expectDb = argValueFrom(argv, '--expect-db');
  if (!expectDb) throw new Error(usage);
  const apply = argv.includes('--apply');
  let maxCostCents: number | null = null;
  if (argv.includes('--max-cost')) {
    const raw = argValueFrom(argv, '--max-cost');
    const dollars = Number(raw);
    if (raw === undefined || raw.trim() === '' || !Number.isFinite(dollars) || dollars < 0) {
      throw new Error(`--max-cost must be a non-negative dollar amount (got '${raw ?? ''}')`);
    }
    maxCostCents = Math.round(dollars * 10000);
  }
  if (apply && maxCostCents === null) throw new Error('--apply requires --max-cost <usd>');
  let bundles: string[] | null = null;
  if (argv.includes('--bundles')) {
    bundles = (argValueFrom(argv, '--bundles') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (bundles.length === 0) throw new Error('--bundles needs a comma-separated list of bundle ids');
  }
  return { expectDb, release: argValueFrom(argv, '--release') ?? DEFAULT_RELEASE, apply, maxCostCents, missing: argv.includes('--missing'), bundles,
    includeSubmittedSamples: argv.includes('--include-submitted-samples') };
}

/** Token figures behind the estimate: input ≈ user message chars/4 + the system-prompt allowance; output is an allowance. */
export function estimatePlacementTokens(input: PlacementInput): { inputTokens: number; outputTokens: number } {
  return { inputTokens: Math.ceil(buildPlacementUserMessage(input).length / 4) + SYSTEM_PROMPT_TOKENS, outputTokens: OUTPUT_TOKENS };
}

/** Dry-run / guard estimate for one placement call, via the one shared price table (lib/ai/openai.ts). */
export function estimatePlacementCents(model: string, input: PlacementInput): number {
  const t = estimatePlacementTokens(input);
  return estimateCostCents(model, t.inputTokens, t.outputTokens);
}

/** The actual cost a provider error reports (a numeric `costUsdCents` on the error), if any. */
export function failedCallCost(err: unknown): number | null {
  const c = (err as { costUsdCents?: unknown } | null)?.costUsdCents;
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : null;
}

const HIDDEN = (id: string) => `${id}: sampled — hidden until blind pick`;
const dollars = (units: number) => `$${(units / 10000).toFixed(4)}`;

// ─── Entry point ────────────────────────────────────────────────────────────

export interface CliDeps {
  executor?: Executor;
  placeBundle?: typeof placeBundle;
  listActiveBundles?: typeof listActiveBundles;
  readConfirmedCards?: typeof readConfirmedCards;
  readElementDefinitions?: typeof readElementDefinitions;
  readTaskStatements?: typeof readTaskStatements;
  readVectors?: typeof readVectors;
  checkDailyCap?: typeof checkDailyCap;
  recordSpend?: typeof recordSpend;
  estimate?: (model: string, input: PlacementInput) => number;
  /** The bundle-map-onet model id; defaults to the configured provider's model. */
  resolveModel?: () => Promise<string>;
}

class Refusal extends Error {}

/**
 * Returns an exit code rather than calling process.exit, so tests can call
 * it directly. Order: parse args (2) → assertExpectedDb before any other
 * read (1) → load + validate every input (3) → scope (unknown --bundles id:
 * 2) → dry run, or the paid per-bundle loop.
 */
export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  let args: MapArgs;
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

  const place = deps.placeBundle ?? placeBundle;
  const checkCap = deps.checkDailyCap ?? checkDailyCap;
  const recordSp = deps.recordSpend ?? recordSpend;
  const estimate = deps.estimate ?? estimatePlacementCents;

  // ── Setup: every input must be present before any call or write (exit 3). ──
  let model: string;
  let inputs: PlacementInput[];
  let submittedInScope: string[] = [];
  // Sampled bundles whose blind pick is not yet submitted: the operator is
  // also the blind reviewer, so their placement results stay off the console.
  let hidden = new Set<string>();
  try {
    const bundles = await (deps.listActiveBundles ?? listActiveBundles)(executor);
    const cards = await (deps.readConfirmedCards ?? readConfirmedCards)(executor);
    const noCard = bundles.filter(b => !cards.has(b.id));
    if (noCard.length > 0) throw new Refusal(`no confirmed card for ${noCard.length} bundle(s) (e.g. '${noCard[0]!.id}') — run draft-bundle-cards --apply first`);

    const elements = await (deps.readElementDefinitions ?? readElementDefinitions)(args.release, executor);
    if (elements.length === 0) throw new Refusal(`no O*NET element definitions for release ${args.release} — run load-onet --apply first`);

    const taskRows = await (deps.readTaskStatements ?? readTaskStatements)(args.release, executor);
    if (taskRows.length === 0) throw new Refusal(`no O*NET task statements for release ${args.release} — run load-onet --apply first`);
    const groups = groupTasks(taskRows);
    const groupByKey = new Map(groups.map(g => [g.key, g]));

    const rv = deps.readVectors ?? readVectors;
    const cardVectors = await rv(executor, 'bundle_card', bundles.map(b => ({ ref: b.id, text: cardEmbedText(b, cards.get(b.id)!) })), DEFAULT_EMBEDDING_MODEL);
    const noCardVec = bundles.filter(b => !cardVectors.has(b.id));
    if (noCardVec.length > 0) throw new Refusal(`missing bundle_card vector for ${noCardVec.length} bundle(s) (e.g. '${noCardVec[0]!.id}') — run embed-items --apply first`);
    const taskVectors = await rv(executor, 'onet_task', groups.map(g => ({ ref: g.key, text: g.label })), DEFAULT_EMBEDDING_MODEL);
    const noTaskVec = groups.filter(g => !taskVectors.has(g.key));
    if (noTaskVec.length > 0) throw new Refusal(`missing task-group vector(s) for ${noTaskVec.length} group(s) (e.g. '${noTaskVec[0]!.key}') — run embed-items --apply first`);

    // ── Scope ──
    let scope = bundles;
    if (args.bundles) {
      const known = new Set(bundles.map(b => b.id));
      const unknown = args.bundles.filter(id => !known.has(id));
      if (unknown.length > 0) {
        console.error(`unknown or inactive bundle id(s) in --bundles: ${unknown.join(', ')}`);
        return 2;
      }
      const wanted = new Set(args.bundles);
      scope = scope.filter(b => wanted.has(b.id));
    }
    if (args.missing) {
      const done = await bundlesWithOkOutcome(executor);
      scope = scope.filter(b => !done.has(b.id));
    }
    const samples = new Map((await executor.select({
      bundleId: bundleGoldenSamples.bundleId, submittedAt: bundleGoldenSamples.submittedAt, candidates: bundleGoldenSamples.candidates,
    }).from(bundleGoldenSamples)).map(r => [r.bundleId, r]));
    submittedInScope = scope.filter(b => samples.get(b.id)?.submittedAt != null).map(b => b.id);
    hidden = new Set([...samples.values()].filter(r => r.submittedAt == null).map(r => r.bundleId));
    if (!args.includeSubmittedSamples) scope = scope.filter(b => !submittedInScope.includes(b.id));

    inputs = scope.map(b => ({
      bundle: b, card: cards.get(b.id)!, elements, release: args.release,
      tasks: shortlistTasks(cardVectors.get(b.id)!, taskVectors, TASK_SHORTLIST_K).map(e => ({ ...groupByKey.get(e.key)!, rank: e.rank })),
    }));
    // Plan Ruling 4: a sampled bundle's placement shortlist must be the first
    // K of its stored blind candidates, or the agreement metrics compare
    // different universes. Checked for every sampled bundle before any call.
    const mismatched = inputs.filter(i => {
      const sample = samples.get(i.bundle.id);
      if (!sample) return false;
      const want = sample.candidates.slice(0, TASK_SHORTLIST_K).map(c => c.key);
      const got = i.tasks.map(t => t.key);
      return want.length !== got.length || want.some((k, j) => k !== got[j]);
    }).map(i => i.bundle.id);
    if (mismatched.length > 0) {
      throw new Refusal(`shortlist differs from the stored golden-sample candidates (plan Ruling 4) for: ${mismatched.join(', ')} — embeddings or task statements changed since the draw; nothing was called or written`);
    }
    model = deps.resolveModel ? await deps.resolveModel() : (await getProviderForFunction('bundle-map-onet')).model;
  } catch (err) {
    console.error(formatDbError(err));
    return 3;
  }

  const estimates = inputs.map(i => estimate(model, i));
  console.log(`mode: ${args.apply ? 'APPLY' : 'DRY RUN'}  expect-db: ${args.expectDb}  release: ${args.release}  model: ${model}  bundles in scope: ${inputs.length}`);
  if (submittedInScope.length > 0) {
    if (args.includeSubmittedSamples) {
      console.log(`WARNING: --include-submitted-samples maps ${submittedInScope.join(', ')} again — their blind sample is already submitted, so their agreement figures will mix AI runs.`);
    } else {
      console.log(`skipped (blind sample submitted): ${submittedInScope.join(', ')} — pass --include-submitted-samples to map them anyway`);
    }
  }

  // ── Dry run: no calls, no writes. ──
  if (!args.apply) {
    let totalIn = 0, totalOut = 0;
    inputs.forEach((input, i) => {
      const t = estimatePlacementTokens(input);
      totalIn += t.inputTokens; totalOut += t.outputTokens;
      if (hidden.has(input.bundle.id)) {
        console.log(`  - ${HIDDEN(input.bundle.id)}  tokens in ~${t.inputTokens} / out ≤${t.outputTokens}  est ${dollars(estimates[i]!)}`);
        return;
      }
      console.log(`  - ${input.bundle.id}  elements ${input.elements.length}  tokens in ~${t.inputTokens} / out ≤${t.outputTokens}  est ${dollars(estimates[i]!)}`);
      for (const t2 of input.tasks.slice(0, PREVIEW_SIZE)) console.log(`      T${t2.rank}. ${t2.label}`);
    });
    console.log(`\nestimated total: tokens in ~${totalIn} / out ≤${totalOut}  ${dollars(estimates.reduce((a, b) => a + b, 0))} (${model}, ${inputs.length} bundle(s))`);
    console.log('DRY RUN — no AI calls, nothing written.');
    return 0;
  }

  if (inputs.length === 0) {
    console.log('nothing to map — no bundle in scope.');
    return 0;
  }

  // ── Apply: one paid call + one transaction per bundle. ──
  const maxCostCents = args.maxCostCents!;
  const runId = await createRun(executor, { model, promptVersion: BUNDLE_MAP_PROMPT_VERSION, taskShortlistK: TASK_SHORTLIST_K, bundleCount: inputs.length });
  let spent = 0, ok = 0, failed = 0, skipped = 0;
  let stopped = false;
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    if (spent + estimates[i]! > maxCostCents) {
      console.log(`stopped at --max-cost (${dollars(spent)} spent); rerun with --missing to continue`);
      stopped = true;
    } else if (!(await checkCap()).ok) {
      console.log(`stopped at the daily cost cap (${dollars(spent)} spent this run); rerun with --missing to continue`);
      stopped = true;
    }
    if (stopped) { skipped = inputs.length - i; break; }

    // Cost of this bundle's call once it has been counted toward `spent`;
    // null while unknown (the call threw before returning its cost).
    let charged: number | null = null;
    try {
      const res = await place(input);
      charged = res.costUsdCents;
      // Count the money before anything else can throw: a recordSpend failure
      // must never make --max-cost undercount a call already paid for.
      spent += charged;
      await recordSp(charged);
      const w = await writeBundleProposals(executor, {
        runId, bundleId: input.bundle.id, rows: res.rows, model: res.model, noCleanMatch: res.noCleanMatch, note: res.note, costUsdCents: res.costUsdCents,
      });
      ok++;
      const r = w.reconcile;
      if (hidden.has(input.bundle.id)) {
        console.log(`OK ${HIDDEN(input.bundle.id)}  cost ${dollars(charged)}`);
        continue;
      }
      console.log(`OK ${input.bundle.id}  placed ${res.rows.length} rows  dropped ids ${res.droppedIds.length}  no-clean-match ${res.noCleanMatch}  reconcile ${r.skipped ? '-' : `${r.confirmed}/${r.added}/${r.disagreements}`}`);
    } catch (err) {
      failed++;
      const message = formatDbError(err);
      if (charged === null) {
        // The call failed with its cost unknown — a non-JSON reply, a refusal
        // or a schema-validation failure is billed before the provider throws.
        // Charge the error's own cost when it carries one, else this bundle's
        // estimate, so repeated failures still hit --max-cost and the daily cap.
        charged = failedCallCost(err) ?? estimates[i]!;
        spent += charged;
        try {
          await recordSp(charged);
        } catch (spErr) {
          console.error(`  (could not record spend for ${input.bundle.id}: ${formatDbError(spErr)})`);
        }
      }
      try {
        await recordFailedOutcome(executor, { runId, bundleId: input.bundle.id, note: message, costUsdCents: charged });
      } catch (recErr) {
        console.error(`  (could not record the failure for ${input.bundle.id}: ${formatDbError(recErr)})`);
      }
      // A provider error can quote the model's reply, so a hidden bundle's stays in the outcome note.
      console.log(hidden.has(input.bundle.id)
        ? `FAILED ${HIDDEN(input.bundle.id)} (error in bundle_mapping_outcomes.note)  cost ${dollars(charged)}`
        : `FAILED ${input.bundle.id}: ${message}`);
    }
  }
  await finishRun(executor, runId, spent);

  console.log(`\nbundles ok ${ok}  failed ${failed}  skipped by cap ${skipped}  total cost ${dollars(spent)}`);
  if (failed > 0) return 1;
  if (stopped) return 4;
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
