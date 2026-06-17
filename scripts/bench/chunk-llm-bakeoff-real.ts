/**
 * REAL-chunk variant of the chunk-LLM bake-off: pulls an actually-indexed
 * material from the DB, chunks it with the production `chunkMaterial`, and runs
 * gpt-oss-120b (campus) vs gpt-5.4-mini (OpenAI) on a sample of real chunks,
 * using the material's real digest as context. gpt-5.5 pairwise judge.
 *
 * Run: set -a; source .env.local; set +a; pnpm exec tsx scripts/bench/chunk-llm-bakeoff-real.ts
 */
import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';
import { chunkMaterial } from '@/lib/capture/chunker';

const CAMPUS_URL = process.env.CAMPUS_LLM_BASE_URL!;
const CAMPUS_KEY = process.env.CAMPUS_LLM_API_KEY!;
const OPENAI_KEY = process.env.OPENAI_API_KEY!;
const OSS = 'gptoss-120b';
const MINI = 'gpt-5.4-mini';
const JUDGE = 'gpt-5.5';
const COURSE = process.env.BENCH_COURSE ?? 'GC 2400';
const N = 10; // chunks to sample

const SYSTEM = `You situate a single chunk of a course document so a retrieval system can place it in context. Given the document digest, the section title, and the chunk text, write a ONE-to-TWO sentence blurb that says what this chunk is and where it sits in the document. Return ONLY JSON: {"blurb":"<one to two sentences>"} and nothing else.`;

interface Result { blurb: string; ms: number; parsed: boolean; }

function parseBlurb(content: string): { blurb: string; parsed: boolean } {
  try { const o = JSON.parse(content) as { blurb?: unknown }; if (typeof o.blurb === 'string' && o.blurb.trim()) return { blurb: o.blurb.trim(), parsed: true }; } catch { /* */ }
  return { blurb: content.slice(0, 200), parsed: false };
}

function userMsg(digest: string, section: string, text: string): string {
  return `DIGEST: ${digest}\n\nSECTION: ${section}\n\nCHUNK: ${text}`;
}

async function callOss(digest: string, section: string, text: string): Promise<Result> {
  const t0 = Date.now();
  const res = await fetch(`${CAMPUS_URL}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${CAMPUS_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: OSS, temperature: 0, reasoning_effort: 'low', response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg(digest, section, text) }] }),
  });
  const ms = Date.now() - t0;
  const j = await res.json() as { choices?: { message?: { content?: string } }[] };
  return { ...parseBlurb(j.choices?.[0]?.message?.content ?? ''), ms };
}

async function callMini(digest: string, section: string, text: string): Promise<Result> {
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MINI, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg(digest, section, text) }] }),
  });
  const ms = Date.now() - t0;
  const j = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (j.error) return { blurb: `ERROR: ${j.error.message}`, parsed: false, ms };
  return { ...parseBlurb(j.choices?.[0]?.message?.content ?? ''), ms };
}

async function judge(digest: string, section: string, text: string, a: string, b: string): Promise<'A' | 'B' | 'tie'> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: JUDGE, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You judge which of two retrieval "blurbs" better situates a document chunk: accurate about what the chunk is and where it sits, concise (1-2 sentences), no hallucination. Return JSON {"winner":"A"|"B"|"tie"}.' },
        { role: 'user', content: `DIGEST: ${digest}\nSECTION: ${section}\nCHUNK: ${text}\n\nBLURB A: ${a}\n\nBLURB B: ${b}\n\nJSON {"winner":"A"|"B"|"tie"}.` },
      ] }),
  });
  const j = await res.json() as { choices?: { message?: { content?: string } }[] };
  try { const w = (JSON.parse(j.choices?.[0]?.message?.content ?? '{}') as { winner?: string }).winner; return w === 'A' || w === 'B' ? w : 'tie'; } catch { return 'tie'; }
}

async function main() {
  const r = await db.execute(sql`
    select file_name, extracted_text, digest from course_materials
    where course_code=${COURSE} and extraction_status='ok' and extracted_text is not null
    order by length(extracted_text) desc limit 1;`);
  const row = (r.rows as Record<string, unknown>[])[0];
  if (!row) { console.error(`no material for ${COURSE}`); process.exit(1); }
  const fileName = String(row.file_name);
  const text = String(row.extracted_text);
  const digest = (row.digest ? String(row.digest) : text.slice(0, 1200)).slice(0, 1500);

  const { details } = chunkMaterial({ fileName, text });
  const usable = details.filter(d => d.text.trim().length >= 200);
  // even spread across the document
  const step = Math.max(1, Math.floor(usable.length / N));
  const sample = usable.filter((_, i) => i % step === 0).slice(0, N);
  console.log(`Course ${COURSE} · "${fileName}" · ${text.length} chars → ${details.length} chunks, sampling ${sample.length}\n`);

  let ossTot = 0, miniTot = 0, ossFail = 0, miniFail = 0, ossWins = 0, miniWins = 0, ties = 0;
  for (let i = 0; i < sample.length; i++) {
    const d = sample[i]!;
    const section = (d.sectionTitle || '(no heading)').slice(0, 60);
    const [oss, mini] = await Promise.all([callOss(digest, section, d.text), callMini(digest, section, d.text)]);
    ossTot += oss.ms; miniTot += mini.ms; if (!oss.parsed) ossFail++; if (!mini.parsed) miniFail++;
    const ossIsA = i % 2 === 0;
    const v = await judge(digest, section, d.text, ossIsA ? oss.blurb : mini.blurb, ossIsA ? mini.blurb : oss.blurb);
    const winner = v === 'tie' ? 'tie' : ((v === 'A') === ossIsA ? 'oss' : 'mini');
    if (winner === 'oss') ossWins++; else if (winner === 'mini') miniWins++; else ties++;
    console.log(`#${i + 1} [${section}] oss ${oss.ms}ms / mini ${mini.ms}ms → judge: ${winner}`);
    console.log(`   oss : ${oss.blurb}`);
    console.log(`   mini: ${mini.blurb}\n`);
  }

  const tOss = Date.now(); await Promise.all(sample.map(d => callOss(digest, (d.sectionTitle || '').slice(0, 60), d.text))); const ossBurst = Date.now() - tOss;
  const tMini = Date.now(); await Promise.all(sample.map(d => callMini(digest, (d.sectionTitle || '').slice(0, 60), d.text))); const miniBurst = Date.now() - tMini;
  const n = sample.length;
  console.log('───────── SUMMARY (real chunks) ─────────');
  console.log(`source: ${COURSE} "${fileName}"`);
  console.log(`avg latency/call:  oss-120b ${Math.round(ossTot / n)}ms  |  5.4-mini ${Math.round(miniTot / n)}ms`);
  console.log(`${n}-chunk burst:    oss-120b ${ossBurst}ms      |  5.4-mini ${miniBurst}ms`);
  console.log(`strict-JSON fails: oss-120b ${ossFail}/${n}       |  5.4-mini ${miniFail}/${n}`);
  console.log(`judge (gpt-5.5):   oss ${ossWins} · mini ${miniWins} · ties ${ties}`);
  process.exit(0);
}
main().catch(e => { console.error('ERR:', e instanceof Error ? e.message : e); process.exit(1); });
