#!/usr/bin/env tsx
/**
 * Light-tier check (2026-10-05): gpt-6-luna (low effort) vs the stored gpt-5.4-mini
 * digests on 10 materials whose digest came from the OpenAI fallback path.
 * (Campus gpt-oss-120b writes most digests for free and is unaffected.)
 *
 * Automated comparison, no reviewers: failures, cost, length, and number fidelity —
 * every number in a digest should appear in the source text (a cheap proxy for
 * invented specifics), and the share of the stored digest's numbers luna keeps.
 * READ-ONLY: nothing is saved; the only write is recordSpend.
 */
import { writeFileSync } from 'node:fs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials } from '@/lib/db/schema';
import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { recordSpend } from '@/lib/rate-limit/daily-cap';

const N = 10;
const nums = (s: string) => new Set((s.match(/\d+(?:[.,]\d+)?%?/g) ?? []).filter(n => n.replace(/\D/g, '').length >= 2));

async function main() {
  const rows = await db.select({ name: courseMaterials.fileName, text: courseMaterials.extractedText, digest: courseMaterials.digest })
    .from(courseMaterials)
    .where(and(eq(courseMaterials.digestModel, 'gpt-5.4-mini'), isNull(courseMaterials.retiredAt), sql`length(${courseMaterials.extractedText}) between 800 and 40000`))
    .limit(N);
  const systemPrompt = await loadPrompt('material-digest');
  const provider = await getProviderForFunction('material-digest', { model: 'gpt-6-luna', reasoningEffort: process.env.EFFORT ?? 'low' });
  const out = [];
  let cost = 0, failures = 0;
  for (const r of rows) {
    const t0 = Date.now();
    try {
      const res = await provider.complete<{ digest: string }>({
        systemPrompt,
        userMessage: [`File name: ${r.name}`, '', 'Material content begins:', '---', r.text ?? '', '---', 'End of material content.', '', 'Return JSON: { "digest": "<the markdown digest>" }'].join('\n'),
        schemaName: 'material_digest',
        jsonSchema: { type: 'object', properties: { digest: { type: 'string' } }, required: ['digest'], additionalProperties: false },
        validate: raw => { const d = (raw as { digest?: unknown }).digest; if (typeof d !== 'string' || !d.trim()) throw new Error('empty digest'); return { digest: d }; },
      });
      await recordSpend(res.costUsdCents); cost += res.costUsdCents / 10_000;
      const src = nums(r.text ?? ''), luna = nums(res.data.digest), stored = nums(r.digest ?? '');
      const lunaInvented = [...luna].filter(n => !src.has(n));
      const storedInvented = [...stored].filter(n => !src.has(n));
      const kept = stored.size ? [...stored].filter(n => luna.has(n)).length / stored.size : null;
      out.push({ file: r.name, secs: (Date.now() - t0) / 1000, lengths: { stored: (r.digest ?? '').length, luna: res.data.digest.length },
        numbersNotInSource: { stored: storedInvented.length, luna: lunaInvented.length, lunaExamples: lunaInvented.slice(0, 5) }, shareOfStoredNumbersKept: kept });
      process.stdout.write('.');
    } catch (e) { failures++; out.push({ file: r.name, error: (e as Error).message.slice(0, 200) }); process.stdout.write('x'); }
  }
  const summary = { files: rows.length, failures, costUsd: cost, results: out };
  writeFileSync(`docs/superpowers/audits/${new Date().toISOString().slice(0, 10)}-light-model-evaluation${process.env.EFFORT ? '-' + process.env.EFFORT : ''}.json`, JSON.stringify(summary, null, 1));
  console.log('\n' + JSON.stringify(summary, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
