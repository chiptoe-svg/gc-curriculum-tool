/**
 * Pure metrics and helpers for the whole-interview benchmark (scripts/capture/interview-sim.ts;
 * plan 2026-11-25-interview-stages, Task 9). No I/O here.
 */

export type Persona = 'normal' | 'terse' | 'skipper' | 'asks-back' | 'yes-sayer';
export const PERSONAS: readonly Persona[] = ['normal', 'terse', 'skipper', 'asks-back', 'yes-sayer'];

export type SimCase = { id: string; courseCode: string; sourceSessionId: string; persona: Persona };
export type SimFact = { id: string; fact: string; sourceTurn: number };

export type SimTurn = { question: string; kind: string; replyMs: number };
export type SimRun = {
  caseId: string;
  turns: SimTurn[];
  /** Fact id → the counted question number at which the instructor stated it, or null (not found). */
  factsFoundAt: Record<string, number | null>;
  /** The interview reached its end (recap answered) within the cap. When absent: asked the recap within 20. */
  finished?: boolean;
};

export type SimSummary = {
  finishedWithin20: number;
  medianTurns: number;
  medianReplyMs: number;
  repeats: number;
  factRecall15: number;
  factRecall20: number;
};

const CAP = 20;
const REPEAT_JACCARD = 0.6;
const COUNTED = new Set(['question', 'follow_up', 'recap']);
const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'do', 'does', 'you', 'your', 'that', 'this', 'it', 'with']);

function tokens(q: string): Set<string> {
  return new Set(q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t && !STOPWORDS.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Questions that repeat an earlier one (normalized token Jaccard >= 0.6). Empty questions are ignored. */
export function repeatCount(questions: string[]): number {
  const seen: Array<Set<string>> = [];
  let repeats = 0;
  for (const q of questions) {
    const t = tokens(q);
    if (!t.size) continue;
    if (seen.some(s => jaccard(s, t) >= REPEAT_JACCARD)) repeats++;
    seen.push(t);
  }
  return repeats;
}

export const countedTurns = (run: SimRun): SimTurn[] => run.turns.filter(t => COUNTED.has(t.kind));

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function finishedWithin20(run: SimRun): boolean {
  if (run.finished !== undefined) return run.finished;
  const counted = countedTurns(run);
  return counted.length <= CAP && counted.some(t => t.kind === 'recap');
}

export function summarize(runs: SimRun[]): SimSummary {
  const facts = runs.flatMap(r => Object.values(r.factsFoundAt));
  const recallBy = (n: number) => (facts.length ? facts.filter(f => f !== null && f <= n).length / facts.length : 0);
  return {
    finishedWithin20: runs.length ? runs.filter(finishedWithin20).length / runs.length : 0,
    medianTurns: median(runs.map(r => countedTurns(r).length)),
    medianReplyMs: median(runs.flatMap(r => r.turns.map(t => t.replyMs))),
    repeats: runs.reduce((n, r) => n + repeatCount(countedTurns(r).map(t => t.question)), 0),
    factRecall15: recallBy(15),
    factRecall20: recallBy(CAP),
  };
}

/**
 * What the simulated instructor does with counted question n (1-based). Deterministic, so runs are
 * comparable: the skipper skips every third question, asks-back answers every fourth (from the second)
 * with a clarifying question instead of an answer.
 */
export function personaAction(persona: Persona, n: number): { action: 'answer' | 'skip' | 'ask-back'; style: string } {
  switch (persona) {
    case 'terse':
      return { action: 'answer', style: 'Answer in a short phrase or one short sentence, never more. Give no examples unless asked twice.' };
    case 'skipper':
      return n % 3 === 0 ? { action: 'skip', style: '' } : { action: 'answer', style: 'Answer naturally and briefly.' };
    case 'asks-back':
      return n % 4 === 2
        ? { action: 'ask-back', style: 'Do not answer yet. Ask the interviewer one short clarifying question about what they mean.' }
        : { action: 'answer', style: 'Answer naturally.' };
    case 'yes-sayer':
      return { action: 'answer', style: 'Agree readily. To any summary or "did I capture this" check, say yes without correcting it. Otherwise answer briefly.' };
    default:
      return { action: 'answer', style: 'Answer naturally, as you did in the earlier interview.' };
  }
}

/** The judge's reply → fact id → turn (1..maxTurn) or null. Tolerates a think block, code fences and string numbers. */
export function parseJudge(raw: string, factIds: string[], maxTurn: number): Record<string, number | null> {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  let obj: Record<string, unknown> = {};
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>; } catch { obj = {}; }
  }
  const out: Record<string, number | null> = {};
  for (const id of factIds) {
    const n = Number(obj[id]);
    out[id] = obj[id] !== null && obj[id] !== undefined && Number.isInteger(n) && n >= 1 && n <= maxTurn ? n : null;
  }
  return out;
}

/** "model[:effort]" → parts. */
export function parseModelSpec(spec: string): { model: string; effort: string | undefined } {
  const [model, effort] = spec.split(':');
  return { model: model!, effort: effort || undefined };
}

/** The only database the benchmark may write (Task 9b fix 5): a literal match, not "contains scratch". */
export const SCRATCH_DB = 'gc_curriculum_p2_scratch';

/** null when `name` is the scratch database; otherwise the refusal message. */
export function checkExpectDb(name: string | undefined): string | null {
  return name === SCRATCH_DB ? null : `refusing: --expect-db must be exactly ${SCRATCH_DB} (got "${name ?? ''}"); the benchmark writes sessions`;
}

export type JudgeExchange = { n: number; kind: string; say: string; question: string; reply: string | null };

/** The run as the fact judge reads it: `#<sequence> Q<counted number>` per exchange, so turns that share a count stay apart. */
export function renderJudgeTranscript(exchanges: JudgeExchange[]): string {
  return exchanges
    .map((e, i) => `#${i + 1} Q${e.n}${e.kind === 'answer_only' ? ' (no new question)' : ''} — Interviewer: ${[e.say, e.question].filter(Boolean).join(' ')}\nInstructor: ${e.reply ?? '(no reply)'}`)
    .join('\n\n');
}
