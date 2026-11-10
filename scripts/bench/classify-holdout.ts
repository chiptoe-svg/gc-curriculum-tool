#!/usr/bin/env tsx
/**
 * material-classify on a campus model, fed exactly what the live app sends
 * (classifyFile in lib/capture/material-tier.ts): filename, MIME type, size and
 * page count, no peek text (neither the upload route nor the Canvas import
 * passes one). The Nov 1 Extract round showed the models the first 500
 * characters and included YouTube transcripts, which never reach the classifier.
 *
 * Input: a JSON array of { id, file_name, mime_type, size_bytes, page_count }
 * pulled read-only from course_materials (non-slide, non-YouTube, non-syllabus
 * files with a stored tier). No database; OpenAI only with PROVIDER=openai and MAX_USD:
 *   env -i PATH=$PATH HOME=$HOME CAMPUS_LLM_BASE_URL=… CAMPUS_LLM_API_KEY=… \
 *     MODEL=qwen3.8-27b-fp8 REASONING=off FILES=files.json OUT=out.json \
 *     [PROMPT_FILE=variant.md] [PEEK=1] pnpm exec tsx scripts/bench/classify-holdout.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CampusProvider, type CampusReasoning } from '@/lib/ai/campus';
import { OpenAIProvider } from '@/lib/ai/openai';
import { loadPrompt } from '@/lib/ai/prompts/load';

const PAID = process.env.PROVIDER === 'openai';
const MAX_USD = Number(process.env.MAX_USD ?? 0);
if (PAID ? !(MAX_USD > 0) : !!process.env.OPENAI_API_KEY) throw new Error(PAID ? 'A paid run needs MAX_USD (a hard spend ceiling)' : 'Unset OPENAI_API_KEY: a campus run must not reach a paid model');
// gpt-5.4-mini list price per million tokens (lib/ai/models.ts); cached input is charged at full price here, so spend is overestimated.
const PRICE = { input: 0.75, output: 4.5 };
if (process.env.DATABASE_URL) throw new Error('Unset DATABASE_URL: this benchmark reads only its input file');
const MODEL = process.env.MODEL!, REASONING = (process.env.REASONING ?? 'off') as CampusReasoning;
if (!MODEL) throw new Error('Set MODEL');

interface File { id: string; file_name: string; mime_type: string; size_bytes: number; page_count: number | null; text?: string | null }

async function main() {
  const files = JSON.parse(readFileSync(process.env.FILES!, 'utf8')) as File[];
  const systemPrompt = process.env.PROMPT_FILE
    ? readFileSync(process.env.PROMPT_FILE, 'utf8').replace(/^---[\s\S]*?---\s*/, '')
    : await loadPrompt('material-classify');
  const provider = PAID
    ? new OpenAIProvider(MODEL, process.env.OPENAI_API_KEY!)
    : new CampusProvider(MODEL, process.env.CAMPUS_LLM_BASE_URL!, process.env.CAMPUS_LLM_API_KEY!, { reasoning: REASONING });
  let spentUsd = 0;
  const limit = Number(process.env.LIMIT ?? files.length);
  const out: Record<string, { tier: string | null; ms: number; error?: string }> = {};
  for (let i = 0; i < Math.min(limit, files.length); i += 5) {
    if (PAID && spentUsd >= MAX_USD) { console.log(`\nstopped at the $${MAX_USD} ceiling after ${i} files`); break; }
    await Promise.all(files.slice(i, Math.min(i + 5, limit)).map(async f => {
      const lines = [`filename: ${f.file_name}`, `mime_type: ${f.mime_type}`, `size_bytes: ${f.size_bytes}`];
      if (f.page_count != null) lines.push(`page_count: ${f.page_count}`);
      if (process.env.PEEK && f.text) lines.push('', 'peek_text (first ~500 chars):', f.text.slice(0, 500));
      lines.push('', 'Return JSON: {"tier":"high"|"middle"|"background"}');
      const t0 = Date.now();
      try {
        const res = await provider.complete<{ tier: string }>({
          systemPrompt, userMessage: lines.join('\n'), schemaName: 'material_classify',
          jsonSchema: { type: 'object', properties: { tier: { type: 'string', enum: ['high', 'middle', 'background'] } }, required: ['tier'], additionalProperties: false },
          validate: raw => { const t = (raw as { tier?: unknown }).tier; if (t !== 'high' && t !== 'middle' && t !== 'background') throw new Error(`bad tier ${String(t)}`); return { tier: t }; },
        });
        const t = res as { cachedTokens?: number; uncachedPromptTokens?: number; completionTokens?: number };
        spentUsd += (((t.cachedTokens ?? 0) + (t.uncachedPromptTokens ?? 0)) * PRICE.input + (t.completionTokens ?? 0) * PRICE.output) / 1e6;
        out[f.id] = { tier: res.data.tier, ms: Date.now() - t0 };
        process.stdout.write('.');
      } catch (e) {
        // The live classifier turns any error into 'background'; keep the error visible here.
        out[f.id] = { tier: null, ms: Date.now() - t0, error: (e as Error).message.slice(0, 200) };
        process.stdout.write('x');
      }
    }));
  }
  writeFileSync(process.env.OUT!, JSON.stringify({ model: MODEL, reasoning: REASONING, prompt: process.env.PROMPT_FILE ?? 'material-classify', peek: !!process.env.PEEK, out }, null, 1));
  console.log(`\n${Object.values(out).filter(r => r.error).length} errors${PAID ? `, about $${spentUsd.toFixed(4)} spent` : ''}`);
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
