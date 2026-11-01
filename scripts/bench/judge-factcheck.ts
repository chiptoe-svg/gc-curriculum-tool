#!/usr/bin/env tsx
/**
 * Evidence fact-check spike for the Judge role (owner idea, 2026-11-01).
 *
 * A separate call with a different context: it never sees the scorer's numbers
 * or reasoning. Per course and competency it gets the profile and the
 * competency's K/U/D descriptors and must quote the profile's evidence of the
 * right kind for each dimension (an assessment item for Know, student-produced
 * reasoning for Understand, a graded task for Do). Code then checks the quote is
 * really in the profile. A score above its floor with no valid quote drops to
 * the floor (K 1, U 0, D 0); a valid quote caps the score at the depth level
 * the checker says that evidence supports.
 *
 * Applies the check to every run stored by role-judge.ts (IN) and writes the
 * adjusted calls (OUT) in the same shape, plus the checker's answers.
 * Campus only, bench DB only, never writes scores:
 *   env -i … DATABASE_URL=<bench> AI_PROVIDER=campus CAMPUS_LLM_BASE_URL=… CAMPUS_LLM_API_KEY=… \
 *     IN=judge-full.json OUT=judge-factcheck.json CHECK_MODEL=deepseek-v4.1-flash-1017 CHECK_LEVEL=low \
 *     pnpm exec tsx scripts/bench/judge-factcheck.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseCaptureSnapshots, snapshotCompetencyCoverage, subCompetencies } from '@/lib/db/schema';
import { campusReasoningParams, type CampusReasoning } from '@/lib/ai/campus';
import { grounded, normText as norm } from '../reliability/grounding';

if (process.env.OPENAI_API_KEY) throw new Error('Unset OPENAI_API_KEY: this benchmark must not reach a paid model');
if (!/gc_curriculum_bench/.test(process.env.DATABASE_URL ?? '')) throw new Error('DATABASE_URL must be the gc_curriculum_bench copy');

const IN = process.env.IN!, OUT = process.env.OUT!;
const MODEL = process.env.CHECK_MODEL ?? 'deepseek-v4.1-flash-1017';
const LEVEL = (process.env.CHECK_LEVEL ?? 'low') as CampusReasoning;
/** Checker runs per competency; the median level is kept (the checker varies run to run). */
const CHECK_RUNS = Number(process.env.CHECK_RUNS ?? 1);
const SINCE = new Date('2026-10-19T16:33:55Z');
const client = new OpenAI({ baseURL: process.env.CAMPUS_LLM_BASE_URL, apiKey: process.env.CAMPUS_LLM_API_KEY });

const SYSTEM = `You check evidence for a curriculum coverage score. You are given one course's profile and one competency.
For each dimension asked, find the single best verbatim quote from the profile that is evidence of THAT kind, for THIS competency:
- know: an assessment item (quiz, exam, test, graded identification) that checks students recall or identify this competency's content.
- understand: students producing reasoning about this competency: explaining why, predicting, comparing, justifying, critiquing. A calculation, a procedure or a finished artifact is NOT reasoning.
- do: a graded deliverable or task students actually perform that exercises this competency.
Not evidence: a lecture topic, reading, schedule item or video alone; course objectives or aspirations ("students will understand"); evidence the profile gives for a different competency unless it also shows this competency itself; written work for spoken communication or spoken work for writing.
Low levels need only modest evidence: a guided task with instructor direction is Do 1; students restating an explanation is Understand 1. Do not demand more than the level needs.
Copy the quote exactly from the profile. If there is no such evidence, use null. Do not guess.
Then give "level": the highest depth level (per the scale below) that the profile's evidence of that kind supports for this competency; 0 when quote is null (Know: 1 when the content is only presented, with no assessment).
Answer JSON only: {"know": {"quote": string|null, "level": number, "why": string}, "understand": {...}, "do": {...}} with only the dimensions asked.

${readFileSync(join(process.cwd(), 'lib/ai/prompts/shared/depth-scale.md'), 'utf8')}`;

interface Cell { sub: string; k: number | null; u: number | null; d: number; excerpt: string }

async function check(profile: unknown, c: typeof subCompetencies.$inferSelect, dims: ('know' | 'understand' | 'do')[]) {
  const desc = { know: c.knowDescriptor, understand: c.understandDescriptor, do: c.doDescriptor };
  const user = `Competency: ${c.name}\n${dims.map(d => `${d} descriptor: ${desc[d] ?? ''}`).join('\n')}\nDimensions to check: ${dims.join(', ')}\n\nCourse profile:\n${JSON.stringify(profile, null, 1)}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await client.chat.completions.create({
        model: MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        response_format: { type: 'json_object' }, ...(campusReasoningParams(MODEL, LEVEL) as object),
      } as OpenAI.ChatCompletionCreateParamsNonStreaming);
      return JSON.parse(r.choices[0]!.message.content ?? '{}') as Record<string, { quote: string | null; level?: number; why: string }>;
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise(res => setTimeout(res, 15_000 * (attempt + 1)));
    }
  }
}

async function main() {
  const src = JSON.parse(readFileSync(IN, 'utf8')) as { courses: string[]; calls: { setup: string; course: string; run: number; ok: boolean; ms: number; cells: Cell[] }[] };
  const verdicts: Record<string, Record<string, { quote: string | null; level: number; why: string; valid: boolean }>> = {};
  for (const course of src.courses) {
    const base = await db.select({ c: snapshotCompetencyCoverage, s: courseCaptureSnapshots })
      .from(snapshotCompetencyCoverage)
      .innerJoin(courseCaptureSnapshots, eq(courseCaptureSnapshots.id, snapshotCompetencyCoverage.snapshotId))
      .where(and(eq(courseCaptureSnapshots.courseCode, course), gte(snapshotCompetencyCoverage.generatedAt, SINCE)));
    const snap = base.map(b => b.s).sort((a, b) => +b.createdAt - +a.createdAt)[0]!;
    const ids = base.filter(b => b.s.id === snap.id).map(b => b.c.competencyId);
    const subs = await db.select().from(subCompetencies).where(inArray(subCompetencies.id, ids));
    const hay = norm(JSON.stringify(snap.profile));
    await Promise.all(subs.map(async c => {
      const foundational = c.foundational;
      const dims = foundational ? (['do'] as const) : (['know', 'understand', 'do'] as const);
      const t0 = Date.now();
      const answers = await Promise.all(Array.from({ length: CHECK_RUNS }, () => check(snap.profile, c, [...dims])));
      const v: Record<string, { quote: string | null; level: number; why: string; valid: boolean }> = {};
      for (const d of dims) {
        const each = answers.map(ans => {
          const q = ans[d]?.quote ?? null;
          const valid = !!q && grounded(q, hay);
          return { quote: q, level: valid ? Number(ans[d]?.level ?? 0) : 0, why: ans[d]?.why ?? '', valid };
        }).sort((a, b) => a.level - b.level);
        v[d] = each[Math.floor((each.length - 1) / 2)]!;
      }
      verdicts[`${course}|${c.id}`] = v;
      process.stdout.write(`${course} ${c.id} ${dims.map(d => `${d[0]}:${v[d]!.valid ? 'Y' : v[d]!.quote ? 'ungrounded' : 'N'}`).join(' ')} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    }));
  }
  const calls = src.calls.map(call => ({
    ...call,
    cells: call.cells.map(cell => {
      const v = verdicts[`${call.course}|${cell.sub}`];
      if (!v) return cell;
      return {
        ...cell,
        // Cap each score at the level the checker's grounded quote supports. Know uses the
        // checker's level as given: it answers 1 for content that is only presented, 0 for none.
        k: cell.k == null || !v.know ? cell.k : Math.min(cell.k, v.know.level),
        u: cell.u == null || !v.understand ? cell.u : Math.min(cell.u, v.understand.level),
        d: !v.do ? cell.d : Math.min(cell.d, v.do.level),
      };
    }),
  }));
  writeFileSync(OUT, JSON.stringify({ checkModel: MODEL, checkLevel: LEVEL, courses: src.courses, verdicts, calls }, null, 1));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
