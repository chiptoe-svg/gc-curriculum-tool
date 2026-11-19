#!/usr/bin/env tsx
/**
 * Retrieval check against a gold set (owner, 2026-11-19: reranker before the move to rag-core).
 *
 * Runs the interviewer's own search path (embedText + the Weaviate hybridSearch the search_materials
 * tool uses) for each gold question and scores hit@1 / hit@3 / hit@10 and MRR@10. A hit is a returned
 * chunk whose fileName equals the pair's file and whose text contains every expected substring
 * (case-insensitive) — the same rule as rag-core's harness (eval/harness.py::_matches).
 *
 * Read-only: queries the live Weaviate index; writes nothing. Compare by running it twice:
 *   RERANK=off node …/tsx scripts/capture/eval-goldset.ts <gold.json>
 *   node …/tsx scripts/capture/eval-goldset.ts <gold.json>
 * The gold file is a JSON array of { id, course_code, file_name, question, expected_substrings }
 * (rag-core's v2.yaml converted; gold sets stay outside the repo).
 */
import { readFileSync } from 'node:fs';
import { loadAppEnv } from '@/scripts/catalog/catalog-source';

interface Pair { id: string; course_code: string; file_name: string; question: string; expected_substrings: string[] }

async function main(): Promise<number> {
  loadAppEnv();
  const file = process.argv[2];
  if (!file) { console.error('usage: eval-goldset.ts <gold.json>'); return 2; }
  const pairs = JSON.parse(readFileSync(file, 'utf8')) as Pair[];
  const { embedText } = await import('@/lib/ai/embeddings');
  const { createVectorStore, tenantForCourse } = await import('@/lib/capture/vector-store');
  const { rerankEnabled } = await import('@/lib/ai/rerank');
  const store = createVectorStore();

  let h1 = 0, h3 = 0, h10 = 0, mrr = 0, ms = 0;
  for (const p of pairs) {
    const t = Date.now();
    const hits = await store.hybridSearch(tenantForCourse(p.course_code), {
      queryVector: await embedText(p.question),
      queryText: p.question,
      k: 10,
    });
    ms += Date.now() - t;
    const want = p.expected_substrings.map(s => s.toLowerCase());
    const rank = hits.findIndex(h => h.fileName === p.file_name && want.every(s => h.text.toLowerCase().includes(s))) + 1;
    if (rank === 1) h1++;
    if (rank >= 1 && rank <= 3) h3++;
    if (rank >= 1) { h10++; mrr += 1 / rank; }
    console.log(`${p.id}: ${rank ? `rank ${rank}` : 'miss'}`);
  }
  const n = pairs.length;
  const pct = (x: number) => `${Math.round((100 * x) / n)}%`;
  console.log(`\nrerank ${rerankEnabled() ? 'on' : 'off'} · ${n} questions · hit@1 ${pct(h1)} · hit@3 ${pct(h3)} · hit@10 ${pct(h10)} · MRR@10 ${(mrr / n).toFixed(3)} · ${Math.round(ms / n)} ms/query (embed + search)`);
  return 0;
}

main().then(code => process.exit(code), err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
