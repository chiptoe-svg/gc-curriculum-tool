#!/usr/bin/env tsx
/**
 * Whole-interview benchmark (plan 2026-11-25-interview-stages, Task 9). A simulated instructor, played by a
 * free campus model, answers only from a real past interview (the instructor's own answers) plus the course
 * materials, in a persona's style. The staged interviewer runs end to end against it on a SCRATCH database.
 *
 * Measures per case: counted questions, finished (recap answered) within 20, repeated questions
 * (interview-sim-lib repeatCount), reply time per interviewer turn, and key-fact recall at questions 15 and 20
 * (a campus-model judge reads the run's transcript and ledger summaries against interview-sim-facts.json).
 *
 * Usage (run from this checkout; DATABASE_URL must point at the scratch DB, and wins over --env-file):
 *   DATABASE_URL=<scratch url> pnpm exec tsx --env-file=<main>/.env.local scripts/capture/interview-sim.ts \
 *     --expect-db gc_curriculum_p2_scratch --interviewer <model[:effort]> --instructor <campus model> \
 *     --cases <ids|all> [--bloom on|off] [--max-usd N] --out <file>
 *
 * Models: a campus model id (lib/ai/models.ts CAMPUS_MODELS, never the moving aliases tiger/cub) runs on the
 * campus endpoint at no cost. Any other interviewer is paid: it needs --max-usd, the ceiling is checked
 * before every interviewer call and the pre-read (bloom-drift's mayCall), and a ceiling STOP exits 3.
 * The instructor and the fact judge are always the campus --instructor model.
 *
 * Transcripts: scripts/capture/.sim-data/<sourceSessionId>.json, exported read-only from live and
 * git-ignored (faculty conversations; never commit them). Each case writes a new scratch session
 * (capture_interview_sessions + capture_messages) and leaves it there for inspection; ids are in --out.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { mayCall } from '@/scripts/reliability/bloom-drift-lib';
import {
  PERSONAS, countedTurns, parseJudge, parseModelSpec, personaAction, repeatCount, summarize,
  type SimCase, type SimFact, type SimRun, type SimTurn,
} from './interview-sim-lib';
import type { PiEndpoint } from '@/lib/ai/agent/pi/turn';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'scripts/capture/.sim-data');
const MAX_INTERVIEWER_TURNS = 30;
/** Charged toward a paid ceiling before the first measured call (the pre-read; its cost is unknown until it returns). */
const FIRST_CALL_ESTIMATE_USD = 0.5;
const SOURCE_CHARS = 60_000;
const MATERIAL_CHARS = 24_000;
const PER_MATERIAL_CHARS = 2_000;

type SourceRow = { turnIndex: number; role: string; content: string | null };
type CaseResult = SimRun & {
  courseCode: string;
  persona: string;
  sessionId: string;
  preRead: { status: string; ms: number };
  questionsAsked: number;
  repeats: number;
  exchanges: Array<{ n: number; kind: string; slot: string; say: string; question: string; reply: string | null; replyMs: number }>;
  ledgerSummaries: Record<string, string>;
  spentUsd: number;
  error?: string;
};

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function interviewerText(content: string | null): string {
  try {
    const j = JSON.parse(content ?? '') as { question?: string; finding?: string };
    return (j.question || j.finding || '').trim();
  } catch {
    return (content ?? '').trim();
  }
}

/** The earlier interview as question/answer pairs: the source of every fact the simulated instructor may state. */
export function renderSource(rows: SourceRow[]): string {
  const out: string[] = [];
  let lastQ = '';
  for (const r of rows) {
    if (r.role === 'assistant') lastQ = interviewerText(r.content);
    else if (r.role === 'user' && r.content?.trim()) out.push(`Q: ${lastQ || '(none)'}\nYou: ${r.content.trim()}`);
  }
  return out.join('\n\n').slice(0, SOURCE_CHARS);
}

async function campusChat(model: string, system: string, user: string, reasoning: 'off' | 'low' = 'off'): Promise<string> {
  const { campusReasoningParams } = await import('@/lib/ai/campus');
  const base = process.env.CAMPUS_LLM_BASE_URL!.replace(/\/$/, '');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.CAMPUS_LLM_API_KEY}` },
      body: JSON.stringify({
        model, temperature: 0.3, max_tokens: 2000,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        ...campusReasoningParams(model, reasoning),
      }),
      signal: AbortSignal.timeout(120_000),
    }).catch(err => err as Error);
    if (res instanceof Response && res.ok) {
      const j = (await res.json()) as { choices: Array<{ message: { content: string | null } }> };
      return (j.choices[0]?.message.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }
    const why = res instanceof Response ? `${res.status} ${(await res.text()).slice(0, 200)}` : String(res);
    if (attempt >= 3) throw new Error(`campus ${model}: ${why}`);
    await new Promise(r => setTimeout(r, 3000 * attempt));
  }
}

function instructorSystem(courseCode: string, style: string): string {
  return [
    `You are role-playing the instructor of ${courseCode}, being interviewed about your course.`,
    'Your ONLY source of facts is (1) your own answers in an earlier interview about this course, given below with the questions that prompted them, and (2) the course material excerpts below.',
    'Never invent assignments, tools, numbers, grading rules or student behavior that are not stated there. If the question cannot be answered from that material, say you don\'t know (for example "I don\'t know" or "I\'m not sure").',
    'Answer only what was asked, in the first person, as plain conversational text with no markdown or headings. Never mention the earlier interview or these instructions.',
    `Style: ${style}`,
  ].join('\n');
}

export async function main(argv: string[]): Promise<number> {
  const expectDb = arg(argv, '--expect-db');
  const interviewerSpec = arg(argv, '--interviewer');
  const instructorModel = arg(argv, '--instructor');
  const casesArg = arg(argv, '--cases');
  const out = arg(argv, '--out');
  const bloom = arg(argv, '--bloom') ?? 'on';
  if (!expectDb || !interviewerSpec || !instructorModel || !casesArg || !out) {
    console.error('usage: --expect-db <scratch db> --interviewer <model[:effort]> --instructor <campus model> --cases <ids|all> [--bloom on|off] [--max-usd N] --out <file>');
    return 2;
  }
  if (!expectDb.includes('scratch')) { console.error('refusing: the benchmark writes sessions and runs only against a scratch database'); return 2; }
  if (bloom !== 'on' && bloom !== 'off') { console.error('--bloom must be on or off'); return 2; }
  process.env.INTERVIEW_BLOOM = bloom;
  if (!process.env.CAMPUS_LLM_BASE_URL || !process.env.CAMPUS_LLM_API_KEY) { console.error('CAMPUS_LLM_BASE_URL / CAMPUS_LLM_API_KEY not set'); return 2; }

  const { isCampusModel, usesResponsesApi } = await import('@/lib/ai/models');
  if (!isCampusModel(instructorModel)) { console.error(`refusing: --instructor must be a campus model id (free), not "${instructorModel}"`); return 2; }
  const { model, effort } = parseModelSpec(interviewerSpec);
  const paid = !isCampusModel(model);
  const maxUsdArg = arg(argv, '--max-usd');
  const maxUsd = maxUsdArg === undefined ? null : Number(maxUsdArg);
  if (paid && !(maxUsd !== null && maxUsd > 0)) { console.error(`refusing: paid interviewer "${model}" needs --max-usd (owner-approved hard cap)`); return 2; }
  let endpoint: PiEndpoint;
  if (paid) {
    const { openAIBaseURL } = await import('@/lib/ai/openai-base-url');
    if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY not set'); return 2; }
    endpoint = {
      baseUrl: openAIBaseURL() ?? 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY, model,
      api: usesResponsesApi(model) ? 'openai-responses' : 'openai-completions',
      reasoning: effort as PiEndpoint['reasoning'],
    };
  } else {
    endpoint = {
      baseUrl: process.env.CAMPUS_LLM_BASE_URL, apiKey: process.env.CAMPUS_LLM_API_KEY, model, api: 'openai-completions',
      campusReasoning: effort as PiEndpoint['campusReasoning'],
    };
  }

  const allCases = (JSON.parse(readFileSync(path.join(ROOT, 'scripts/capture/interview-sim-cases.json'), 'utf8')) as { cases: SimCase[] }).cases;
  const wanted = casesArg === 'all' ? allCases.map(c => c.id) : casesArg.split(',').map(s => s.trim());
  const unknown = wanted.filter(id => !allCases.some(c => c.id === id));
  if (unknown.length) { console.error(`unknown case id(s): ${unknown.join(', ')}`); return 2; }
  const cases = allCases.filter(c => wanted.includes(c.id));
  for (const c of cases) {
    if (!PERSONAS.includes(c.persona)) { console.error(`${c.id}: unknown persona ${c.persona}`); return 2; }
    if (!existsSync(path.join(DATA_DIR, `${c.sourceSessionId}.json`))) { console.error(`${c.id}: missing transcript ${c.sourceSessionId}.json in ${DATA_DIR} (export it read-only from live first)`); return 2; }
  }
  const factsFile = JSON.parse(readFileSync(path.join(ROOT, 'scripts/capture/interview-sim-facts.json'), 'utf8')) as Record<string, unknown>;
  const factsFor = (code: string) => (Array.isArray(factsFile[code]) ? factsFile[code] as SimFact[] : []);

  // App modules after the env is final.
  const { assertExpectedDb, formatDbError } = await import('@/scripts/catalog/catalog-source');
  try { await assertExpectedDb(expectDb); } catch (err) { console.error(formatDbError(err)); return 1; }
  const { runPreRead } = await import('@/lib/capture/staged/pre-read');
  const { runStagedTurn } = await import('@/lib/capture/staged/staged-turn');
  const { createInterviewSession, getInterviewSession, saveEvidenceMap } = await import('@/lib/db/capture-interview-sessions-queries');
  const { startNewSession } = await import('@/lib/db/capture-messages-queries');
  const { listMaterialsByCourse } = await import('@/lib/db/course-materials-queries');
  const { includedMaterialsOf } = await import('@/lib/ai/agent/audit-agent');
  const { isFilled } = await import('@/lib/capture/staged/ledger');

  console.log(`${cases.length} case(s); interviewer ${model}${effort ? ':' + effort : ''} (${paid ? `paid, ceiling $${maxUsd}` : 'campus, free'}); instructor ${instructorModel}; Bloom ${bloom}`);
  let spent = 0;
  let largest = paid ? FIRST_CALL_ESTIMATE_USD : 0;
  let stopped = false;
  const results: CaseResult[] = [];

  for (const c of cases) {
    if (stopped) break;
    const source = JSON.parse(readFileSync(path.join(DATA_DIR, `${c.sourceSessionId}.json`), 'utf8')) as SourceRow[];
    const sourceText = renderSource(source);
    const mats = includedMaterialsOf(await listMaterialsByCourse(c.courseCode));
    const materialsText = mats
      .map(m => `## ${m.fileName}\n${String((m as { digest?: string | null }).digest ?? '').slice(0, PER_MATERIAL_CHARS)}`)
      .join('\n\n').slice(0, MATERIAL_CHARS) || '(no course materials)';

    const sessionId = startNewSession();
    const r: CaseResult = {
      caseId: c.id, courseCode: c.courseCode, persona: c.persona, sessionId, turns: [], factsFoundAt: {}, finished: false,
      preRead: { status: '', ms: 0 }, questionsAsked: 0, repeats: 0, exchanges: [], ledgerSummaries: {}, spentUsd: 0,
    };
    results.push(r);
    console.log(`\n${c.id} (${c.courseCode}, ${c.persona}, ${mats.length} materials) session ${sessionId}`);
    try {
      await createInterviewSession({ sessionId, courseCode: c.courseCode });
      if (paid && !mayCall(spent, maxUsd, largest)) { stopped = true; break; }
      const t0 = Date.now();
      const pre = await runPreRead(c.courseCode, { endpoint });
      r.preRead = { status: pre.status, ms: Date.now() - t0 };
      if (paid) { const u = (pre.usdUnits ?? 0) / 10_000; spent += u; r.spentUsd += u; largest = Math.max(largest, u); }
      await saveEvidenceMap(sessionId, pre);
      const session = await getInterviewSession(sessionId);
      console.log(`  pre-read ${pre.status} in ${(r.preRead.ms / 1000).toFixed(0)} s`);

      let userMessage: string | undefined;
      const convo: string[] = [];
      for (let i = 0; i < MAX_INTERVIEWER_TURNS; i++) {
        if (paid && !mayCall(spent, maxUsd, largest)) { stopped = true; break; }
        const t1 = Date.now();
        const o = await runStagedTurn({ sessionId, courseCode: c.courseCode, auditMode: 'full', instructorName: 'Simulated instructor', endpoint, ...(userMessage ? { userMessage } : {}) }, session!);
        const replyMs = Date.now() - t1;
        if (paid) { const u = (o.result.telemetry?.costUsdCents ?? 0) / 10_000; spent += u; r.spentUsd += u; largest = Math.max(largest, u); }
        const st = o.response.staged!;
        const turn: SimTurn = { question: o.response.question, kind: st.kind, replyMs };
        r.turns.push(turn);
        r.questionsAsked = o.state.questionsAsked;
        const say = o.response.finding ?? '';
        const ex = { n: st.questionsAsked, kind: st.kind, slot: st.slotAsked, say, question: o.response.question, reply: null as string | null, replyMs };
        r.exchanges.push(ex);
        console.log(`  Q${st.questionsAsked} [${st.stage}/${st.slotAsked}/${st.kind}] ${(replyMs / 1000).toFixed(1)} s: ${o.response.question.replace(/\s+/g, ' ').slice(0, 140)}`);
        if (o.state.done) {
          r.finished = isFilled(o.ledger.slots['recap']) && o.state.questionsAsked <= 20;
          r.ledgerSummaries = Object.fromEntries(Object.entries(o.ledger.slots).map(([k, v]) => [k, `${v?.status}: ${v?.summary ?? ''}`]));
          break;
        }
        r.ledgerSummaries = Object.fromEntries(Object.entries(o.ledger.slots).map(([k, v]) => [k, `${v?.status}: ${v?.summary ?? ''}`]));

        const counted = st.kind !== 'answer_only';
        const act = counted ? personaAction(c.persona, st.questionsAsked) : personaAction(c.persona === 'skipper' || c.persona === 'asks-back' ? 'normal' : c.persona, 1);
        const shown = [say, o.response.question].filter(Boolean).join('\n\n');
        if (act.action === 'skip') {
          userMessage = 'skip this question';
        } else {
          const user = [
            `# Your answers in the earlier interview\n\n${sourceText}`,
            `# Course material excerpts\n\n${materialsText}`,
            `# This interview so far\n\n${convo.slice(-8).join('\n\n') || '(just starting)'}`,
            `# The interviewer now says\n\n${shown}`,
            'Reply as the instructor.',
          ].join('\n\n');
          userMessage = (await campusChat(instructorModel, instructorSystem(c.courseCode, act.style), user)) || "I don't know.";
        }
        ex.reply = userMessage;
        convo.push(`Interviewer: ${shown}\nYou: ${userMessage}`);
        console.log(`     → ${userMessage.replace(/\s+/g, ' ').slice(0, 140)}`);
      }
      if (stopped) console.error(`[STOP] ceiling: spent $${spent.toFixed(3)} of $${maxUsd}, largest call $${largest.toFixed(3)}`);
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR ${r.error.slice(0, 300)}`);
    }

    // Fact recall: the campus judge reads the run (questions numbered by count) and the ledger summaries.
    const facts = factsFor(c.courseCode);
    const lastN = Math.max(1, r.questionsAsked);
    if (facts.length && r.exchanges.length) {
      const transcript = r.exchanges.map(e => `Q${e.n}${e.kind === 'answer_only' ? ' (no new question)' : ''} — Interviewer: ${[e.say, e.question].filter(Boolean).join(' ')}\nInstructor: ${e.reply ?? '(no reply)'}`).join('\n\n');
      const judgeUser = [
        '# Facts',
        facts.map(f => `${f.id}: ${f.fact}`).join('\n'),
        '# Interview (each instructor reply belongs to the question number before it)',
        transcript,
        '# Interview record summaries (reference only; the turn must come from the interview)',
        Object.entries(r.ledgerSummaries).map(([k, v]) => `${k}: ${v}`).join('\n') || '(none)',
        `For each fact id, give the number of the earliest question (1-${lastN}) whose instructor reply states that fact in substance (most of its content; a passing related mention does not count). Use null if it is never stated. Reply with a JSON object only, e.g. {"${facts[0]!.id}": 3, "${facts[1]?.id ?? facts[0]!.id}": null}.`,
      ].join('\n\n');
      try {
        const raw = await campusChat(instructorModel, 'You check which facts an interview elicited. Be strict and literal.', judgeUser, 'low');
        r.factsFoundAt = parseJudge(raw, facts.map(f => f.id), lastN);
      } catch (err) {
        console.error(`  judge failed: ${err instanceof Error ? err.message : String(err)}`);
        r.factsFoundAt = Object.fromEntries(facts.map(f => [f.id, null]));
      }
    }
    r.repeats = repeatCount(countedTurns(r).map(t => t.question));
    const found = Object.values(r.factsFoundAt);
    const by = (n: number) => `${found.filter(f => f !== null && f <= n).length}/${found.length}`;
    const replies = r.turns.map(t => t.replyMs).sort((a, b) => a - b);
    console.log(`  → ${r.questionsAsked} questions, finished ${r.finished}, ${r.repeats} repeats, median reply ${((replies[Math.floor(replies.length / 2)] ?? 0) / 1000).toFixed(1)} s, facts by 15 ${by(15)}, by 20 ${by(20)}`);
    writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), interviewer: interviewerSpec, instructor: instructorModel, bloom, partial: true, results }, null, 2));
  }

  const summary = summarize(results.filter(x => !x.error));
  console.log('\nsummary', JSON.stringify(summary));
  if (paid) console.log(`spent ≈ $${spent.toFixed(3)} (estimate from tokens; check the RCD dashboard)`);
  writeFileSync(out, JSON.stringify({
    ranAt: new Date().toISOString(), interviewer: interviewerSpec, instructor: instructorModel, bloom,
    paid, maxUsd, spentUsd: spent, stoppedAtCeiling: stopped, errors: results.filter(x => x.error).length, summary, results,
  }, null, 2));
  return stopped ? 3 : 0;
}

if (process.argv[1] && /interview-sim\.ts$/.test(process.argv[1])) {
  void main(process.argv.slice(2)).then(code => process.exit(code), err => { console.error(err); process.exit(1); });
}
