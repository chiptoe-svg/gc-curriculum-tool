/**
 * Chunk-LLM bake-off: campus gpt-oss-120b vs OpenAI gpt-5.4-mini for the
 * `chunk-contextualize` task (the per-chunk "blurb" used by contextual
 * retrieval). One-off experiment, not wired into the app.
 *
 * Run: set -a; source .env.local; set +a; pnpm exec tsx scripts/bench/chunk-llm-bakeoff.ts
 * Needs: CAMPUS_LLM_BASE_URL + CAMPUS_LLM_API_KEY, OPENAI_API_KEY.
 *
 * Measures: per-call latency, the N-chunk burst wall-time (parallel), strict
 * {blurb} JSON parse success (the thinking-off gate), and blurb quality via a
 * gpt-5.5 pairwise judge (order-randomized to cancel position bias).
 */

const CAMPUS_URL = process.env.CAMPUS_LLM_BASE_URL!;
const CAMPUS_KEY = process.env.CAMPUS_LLM_API_KEY!;
const OPENAI_KEY = process.env.OPENAI_API_KEY!;
const OSS = 'gptoss-120b';
const MINI = 'gpt-5.4-mini';
const JUDGE = 'gpt-5.5';

const SYSTEM = `You situate a single chunk of a course document so a retrieval system can place it in context. Given the document digest, the section title, and the chunk text, write a ONE-to-TWO sentence blurb that says what this chunk is and where it sits in the document. Return ONLY JSON: {"blurb":"<one to two sentences>"} and nothing else.`;

const DIGEST = `A Clemson Graphic Communications "Ink & Substrates" (GC 3460) lab manual: ink and substrate properties, CMYK and spot/Pantone color, dot gain / tone value increase, densitometry and spectrophotometry (Delta E), color separation, ICC profiling and proofing, and press-side quality control.`;

const CHUNKS: { section: string; text: string }[] = [
  { section: 'Measuring tone value increase', text: 'To measure dot gain, print the test target, read the 50% tint patch with a densitometer, and compare the measured tonal value against the file value. Record TVI at the 25%, 50%, and 75% patches and plot the curve.' },
  { section: 'Project 2 rubric — Brand color report', text: 'Deliverable: a press-ready PDF and a 1-page Delta E report. Graded on: correct ICC profile selection (20 pts), measured Delta E 2000 under D50 vs the brand target (30 pts), and a written justification of any out-of-tolerance patches (10 pts).' },
  { section: 'Why spot colors exist', text: 'Some brand colors fall outside the CMYK gamut, so they cannot be reproduced reliably with process inks. A spot ink is a pre-mixed ink applied on its own plate, giving a consistent color across runs that a process build would drift away from.' },
  { section: 'Spectrophotometer calibration', text: 'Calibrate against the white and black reference tiles before each session. Set the illuminant to D50 and the 2-degree observer. Take five readings across the patch and average; discard any reading whose Delta E from the mean exceeds 1.0.' },
  { section: 'Glossary', text: 'TVI: tone value increase, the difference between the intended and printed dot area. Substrate: the material being printed on. Gamut: the range of colors a device or process can reproduce.' },
  { section: 'Lab safety', text: 'Wear nitrile gloves when handling solvents. Dispose of ink-soaked rags in the closed metal bin. Do not eat at the press.' },
];

interface Result { blurb: string; ms: number; parsed: boolean; raw: string; }

function parseBlurb(content: string): { blurb: string; parsed: boolean } {
  try {
    const o = JSON.parse(content) as { blurb?: unknown };
    if (typeof o.blurb === 'string' && o.blurb.trim()) return { blurb: o.blurb.trim(), parsed: true };
  } catch { /* fall through */ }
  return { blurb: content.slice(0, 200), parsed: false };
}

async function callOss(section: string, text: string): Promise<Result> {
  const t0 = Date.now();
  const res = await fetch(`${CAMPUS_URL}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${CAMPUS_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OSS, temperature: 0, reasoning_effort: 'low', response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `DIGEST: ${DIGEST}\n\nSECTION: ${section}\n\nCHUNK: ${text}` }],
    }),
  });
  const ms = Date.now() - t0;
  const j = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = j.choices?.[0]?.message?.content ?? '';
  return { ...parseBlurb(content), ms, raw: content };
}

async function callOpenAI(model: string, section: string, text: string): Promise<Result> {
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `DIGEST: ${DIGEST}\n\nSECTION: ${section}\n\nCHUNK: ${text}` }],
    }),
  });
  const ms = Date.now() - t0;
  const j = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (j.error) return { blurb: `ERROR: ${j.error.message}`, parsed: false, ms, raw: JSON.stringify(j.error) };
  const content = j.choices?.[0]?.message?.content ?? '';
  return { ...parseBlurb(content), ms, raw: content };
}

// gpt-5.5 pairwise judge. Returns 'A' | 'B' | 'tie'. A/B are shuffled per call.
async function judge(section: string, text: string, a: string, b: string): Promise<'A' | 'B' | 'tie'> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: JUDGE, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You judge which of two retrieval "blurbs" better situates a document chunk: it should accurately say what the chunk is and where it sits, be concise (1-2 sentences), and not hallucinate. Return JSON {"winner":"A"|"B"|"tie"}.' },
        { role: 'user', content: `DIGEST: ${DIGEST}\nSECTION: ${section}\nCHUNK: ${text}\n\nBLURB A: ${a}\n\nBLURB B: ${b}\n\nWhich blurb is better? JSON {"winner":"A"|"B"|"tie"}.` },
      ],
    }),
  });
  const j = await res.json() as { choices?: { message?: { content?: string } }[] };
  try { const w = (JSON.parse(j.choices?.[0]?.message?.content ?? '{}') as { winner?: string }).winner; return w === 'A' || w === 'B' ? w : 'tie'; } catch { return 'tie'; }
}

async function main() {
  console.log(`Bake-off: ${OSS} (campus) vs ${MINI} (OpenAI) — ${CHUNKS.length} chunks, judge=${JUDGE}\n`);
  // Per-chunk sequential so the printout is readable; burst timing measured separately.
  let ossTotMs = 0, miniTotMs = 0, ossFail = 0, miniFail = 0, ossWins = 0, miniWins = 0, ties = 0;
  for (let i = 0; i < CHUNKS.length; i++) {
    const c = CHUNKS[i]!;
    const [oss, mini] = await Promise.all([callOss(c.section, c.text), callOpenAI(MINI, c.section, c.text)]);
    ossTotMs += oss.ms; miniTotMs += mini.ms;
    if (!oss.parsed) ossFail++;
    if (!mini.parsed) miniFail++;
    // shuffle A/B
    const ossIsA = i % 2 === 0;
    const verdict = await judge(c.section, c.text, ossIsA ? oss.blurb : mini.blurb, ossIsA ? mini.blurb : oss.blurb);
    const winner = verdict === 'tie' ? 'tie' : ((verdict === 'A') === ossIsA ? 'oss' : 'mini');
    if (winner === 'oss') ossWins++; else if (winner === 'mini') miniWins++; else ties++;
    console.log(`#${i + 1} [${c.section}]`);
    console.log(`  oss-120b (${oss.ms}ms${oss.parsed ? '' : ' PARSE-FAIL'}): ${oss.blurb}`);
    console.log(`  5.4-mini (${mini.ms}ms${mini.parsed ? '' : ' PARSE-FAIL'}): ${mini.blurb}`);
    console.log(`  judge: ${winner}\n`);
  }

  // Burst timing: fire all chunks at once at each engine, measure wall-time.
  const tOss = Date.now(); await Promise.all(CHUNKS.map(c => callOss(c.section, c.text))); const ossBurst = Date.now() - tOss;
  const tMini = Date.now(); await Promise.all(CHUNKS.map(c => callOpenAI(MINI, c.section, c.text))); const miniBurst = Date.now() - tMini;

  const n = CHUNKS.length;
  console.log('───────── SUMMARY ─────────');
  console.log(`avg latency/call:  oss-120b ${Math.round(ossTotMs / n)}ms   |  5.4-mini ${Math.round(miniTotMs / n)}ms`);
  console.log(`${n}-chunk burst:     oss-120b ${ossBurst}ms       |  5.4-mini ${miniBurst}ms`);
  console.log(`strict-JSON fails: oss-120b ${ossFail}/${n}        |  5.4-mini ${miniFail}/${n}`);
  console.log(`judge (gpt-5.5):   oss wins ${ossWins} · mini wins ${miniWins} · ties ${ties}`);
  console.log(`cost:              oss-120b = $0 (campus)  |  5.4-mini = OpenAI per-token`);
}

main().catch(e => { console.error(e); process.exit(1); });
