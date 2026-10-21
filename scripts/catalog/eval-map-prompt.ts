#!/usr/bin/env tsx
/**
 * Prompt evaluation for bundle-map-onet against the SUBMITTED blind samples
 * (owner, 2026-10-21: recall failed at 38%, "widen prompt, re-map"). Places
 * each submitted-sample bundle with the CURRENT prompt file, holds the result
 * in memory, and scores it against the reviewer's saved picks exactly as
 * bundle-agreement-report does (computeAgreement, core + related, shown-list
 * exclusion). Writes NO bundle rows: a real re-map of a submitted bundle
 * drops AI placements that collide with reviewer rows (map-bundles-onet
 * header), which would understate the result being measured. The only write
 * is recordSpend, so the daily cap stays honest.
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/catalog/eval-map-prompt.ts --expect-db <name> --max-cost <usd> [--out <file.json>]
 *
 * Exit codes: 1 wrong database · 2 bad args · 3 refusal before any call · 4 stopped by --max-cost or the daily cap.
 */
import { writeFileSync } from 'node:fs';
import { db } from '@/lib/db/client';
import { bundleGoldenSamples } from '@/lib/db/schema';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb } from '@/scripts/catalog/catalog-source';
import { cardEmbedText } from '@/lib/catalog/bundles';
import { groupTasks, shortlistTasks } from '@/lib/catalog/shortlist';
import {
  listActiveBundles, readConfirmedCards, readTaskStatements, readVectors, readElementDefinitions, readAgreementInputs,
} from '@/lib/db/bundle-queries';
import { placeBundle, TASK_SHORTLIST_K, BUNDLE_MAP_PROMPT_VERSION } from '@/lib/ai/catalog/map-bundle-onet';
import { estimatePlacementCents } from '@/scripts/catalog/map-bundles-onet';
import { getProviderForFunction } from '@/lib/ai/provider';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';
import { computeAgreement, sumAgreement, itemKey, type AgreementRow, type Pos } from '@/lib/catalog/agreement';

const RELEASE = '31.0';
const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const line = (r: AgreementRow) =>
  `${r.bundleId.padEnd(26)} AI ${String(r.aiCount).padStart(3)}  reviewer ${String(r.blindCount).padStart(3)}  both ${String(r.both).padStart(3)}  same position ${String(r.exact).padStart(3)}  precision ${pct(r.precision).padStart(6)}  recall ${pct(r.recall).padStart(6)}`;

export async function main(argv: string[]): Promise<number> {
  const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const expectDb = val('--expect-db');
  const maxUsd = Number(val('--max-cost'));
  if (!expectDb || !Number.isFinite(maxUsd) || maxUsd <= 0) {
    console.error('usage: --expect-db <name> --max-cost <usd> [--out <file.json>]');
    return 2;
  }
  const maxUnits = Math.round(maxUsd * 10000);
  try { await assertExpectedDb(expectDb, db); } catch (err) { console.error(formatDbError(err)); return 1; }

  const { inputs: current } = await readAgreementInputs(db);
  if (current.length === 0) { console.error('no submitted, mapped blind samples'); return 3; }
  const scopeIds = new Set(current.map(i => i.bundleId));

  const bundles = (await listActiveBundles(db)).filter(b => scopeIds.has(b.id));
  const cards = await readConfirmedCards(db);
  const elements = await readElementDefinitions(RELEASE, db);
  const groups = groupTasks(await readTaskStatements(RELEASE, db));
  const groupByKey = new Map(groups.map(g => [g.key, g]));
  const cardVectors = await readVectors(db, 'bundle_card', bundles.map(b => ({ ref: b.id, text: cardEmbedText(b, cards.get(b.id)!) })), DEFAULT_EMBEDDING_MODEL);
  const taskVectors = await readVectors(db, 'onet_task', groups.map(g => ({ ref: g.key, text: g.label })), DEFAULT_EMBEDDING_MODEL);
  const samples = new Map((await db.select({ bundleId: bundleGoldenSamples.bundleId, candidates: bundleGoldenSamples.candidates }).from(bundleGoldenSamples)).map(r => [r.bundleId, r]));

  const inputs = bundles.map(b => ({
    bundle: b, card: cards.get(b.id)!, elements, release: RELEASE,
    tasks: shortlistTasks(cardVectors.get(b.id)!, taskVectors, TASK_SHORTLIST_K).map(e => ({ ...groupByKey.get(e.key)!, rank: e.rank })),
  }));
  // Same guard as map-bundles-onet (plan Ruling 4): the AI must see the tasks the reviewer saw.
  const mismatched = inputs.filter(i => {
    const want = samples.get(i.bundle.id)!.candidates.slice(0, TASK_SHORTLIST_K).map(c => c.key);
    const got = i.tasks.map(t => t.key);
    return want.length !== got.length || want.some((k, j) => k !== got[j]);
  }).map(i => i.bundle.id);
  if (mismatched.length > 0) { console.error(`shortlist differs from the stored candidates for: ${mismatched.join(', ')}`); return 3; }

  const model = (await getProviderForFunction('bundle-map-onet')).model;
  console.log(`prompt ${BUNDLE_MAP_PROMPT_VERSION}  model ${model}  bundles ${inputs.length}  expect-db ${expectDb}  (no bundle rows written)\n`);

  let spent = 0;
  const newRows: AgreementRow[] = [];
  const raw: Record<string, unknown> = {};
  for (const input of inputs) {
    const est = estimatePlacementCents(model, input);
    if (spent + est > maxUnits) { console.log(`stopped at --max-cost ($${(spent / 10000).toFixed(4)} spent)`); return 4; }
    if (!(await checkDailyCap()).ok) { console.log('stopped at the daily cost cap'); return 4; }
    const res = await placeBundle(input);
    spent += res.costUsdCents;
    await recordSpend(res.costUsdCents);
    const ai = new Map<string, Pos>();
    for (const r of res.rows) ai.set(itemKey(r.source, r.source === 'onet_element' ? r.externalId : r.externalLabel), r.position);
    const cur = current.find(c => c.bundleId === input.bundle.id)!;
    newRows.push(computeAgreement({ ...cur, ai }));
    raw[input.bundle.id] = res.rows;
  }

  const oldRows = current.map(c => computeAgreement(c));
  console.log(`CURRENT mapping (bundle-map-onet@1)`);
  for (const r of oldRows) console.log('  ' + line(r));
  console.log('  ' + line(sumAgreement(oldRows)));
  console.log(`\nREVISED prompt (${BUNDLE_MAP_PROMPT_VERSION})`);
  for (const r of newRows) console.log('  ' + line(r));
  console.log('  ' + line(sumAgreement(newRows)));
  console.log(`\nspent $${(spent / 10000).toFixed(4)}`);
  const out = val('--out');
  if (out) writeFileSync(out, JSON.stringify({ promptVersion: BUNDLE_MAP_PROMPT_VERSION, model, placements: raw }, null, 1));
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code), err => { console.error(formatDbError(err)); process.exit(3); });
}
