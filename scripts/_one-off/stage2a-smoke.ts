#!/usr/bin/env tsx
// scripts/_one-off/stage2a-smoke.ts
//
// Exercises the Stage 2a ingestion pipeline end-to-end against a fixture
// material — no DB writes, just digest + chunk + contextualize + embed +
// search. Run from project root with .env.local loaded:
//
//   AI_PROVIDER=campus npx tsx --env-file=.env.local scripts/_one-off/stage2a-smoke.ts
//

import { generateMaterialDigest } from '@/lib/ai/analyze/material-digest';
import { contextualizeChunk } from '@/lib/ai/analyze/chunk-contextualize';
import { embedBatch, embedText } from '@/lib/ai/embeddings';
import { chunkMaterial } from '@/lib/capture/chunker';
import { detectFerpaRisk } from '@/lib/capture/ferpa-detect';
import { evaluateMaterialsPolicy } from '@/lib/capture/materials-policy';
import { createInMemoryVectorStore, tenantForCourse } from '@/lib/capture/vector-store';

const FIXTURE = `# Chapter 4 — Color Reproduction

This chapter introduces the perceptual basis of color difference. ΔE values quantify how different two colors appear to a typical observer.

## ΔE thresholds

A ΔE of 1.0 is generally regarded as the just-noticeable difference for most observers under controlled viewing conditions. Values above 3 are clearly perceptible.

## Press calibration

The press is calibrated against a known reference. Operators measure ΔE between the printed sample and the reference to confirm calibration is within tolerance.
`;

(async () => {
  console.log('=== Stage 2a smoke ===\n');

  const policy = evaluateMaterialsPolicy({
    fileName: 'Canvas File: Ch4.md',
    extractedText: FIXTURE,
    courseHasLearningObjectives: false,
  });
  const ferpa = detectFerpaRisk(FIXTURE);
  console.log('Policy:', policy);
  console.log('FERPA:', ferpa.level, '— matches:', ferpa.matches.length);

  console.log('\n--- digest ---');
  const t0 = Date.now();
  const { digest, model: digestModel } = await generateMaterialDigest({
    fileName: 'Canvas File: Ch4.md',
    extractedText: FIXTURE,
  });
  console.log(`[${Date.now() - t0}ms, model=${digestModel}]`);
  console.log(digest.slice(0, 600) + (digest.length > 600 ? '\n...[truncated]' : ''));

  console.log('\n--- chunks ---');
  const { sections, details } = chunkMaterial({ fileName: 'Canvas File: Ch4.md', text: FIXTURE });
  console.log(`${sections.length} sections, ${details.length} detail chunks`);
  details.forEach((d, i) => console.log(`  detail ${i}: §"${d.sectionTitle}" — ${d.text.slice(0, 60).replace(/\n/g, ' ')}...`));

  console.log('\n--- contextualize ---');
  const t1 = Date.now();
  const blurbs = await Promise.all(details.map(d => contextualizeChunk({
    materialDigest: digest,
    sectionTitle: d.sectionTitle,
    chunkText: d.text,
  })));
  console.log(`[${Date.now() - t1}ms for ${blurbs.length} chunks in parallel]`);
  blurbs.forEach((b, i) => console.log(`  chunk ${i}: ${b.blurb}`));

  console.log('\n--- embed ---');
  const t2 = Date.now();
  const toEmbed = details.map((d, i) => `${blurbs[i]!.blurb}\n\n${d.text}`);
  const vectors = await embedBatch(toEmbed);
  console.log(`[${Date.now() - t2}ms] embedded ${vectors.length} chunks, dim=${vectors[0]?.length}`);

  console.log('\n--- index + search ---');
  const store = createInMemoryVectorStore();
  const tenant = tenantForCourse('GC 4800');
  await store.upsertSections(tenant, sections.map(s => ({
    id: s.id, materialId: 'm1', title: s.title, index: s.index, text: s.text,
  })));
  await store.upsert(tenant, details.map((d, i) => ({
    id: d.id, vector: vectors[i]!, materialId: 'm1',
    courseCode: 'GC 4800', fileName: 'Canvas File: Ch4.md',
    sectionTitle: d.sectionTitle, sectionIndex: d.sectionIndex,
    parentSectionId: d.parentSectionId, text: d.text,
    contextBlurb: blurbs[i]!.blurb,
  })));

  const query = 'how do operators verify press calibration?';
  const qVec = await embedText(query);
  const hits = await store.hybridSearch(tenant, { queryVector: qVec, queryText: query, k: 3 });
  console.log(`\nQuery: "${query}"`);
  hits.forEach((h, i) => console.log(`  [#${i + 1} score=${h.score.toFixed(3)}] §${h.sectionTitle}: ${h.text.slice(0, 100).replace(/\n/g, ' ')}...`));

  console.log('\n=== done ===');
})().catch(e => { console.error('SMOKE FAILED:', e); process.exitCode = 1; });
