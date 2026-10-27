#!/usr/bin/env tsx
/**
 * Interview replay test (owner, 2026-10-27). Re-runs chosen interviewer turns
 * of a real capture session with the current interviewer instructions and with
 * a revised "When to retrieve" section, from the identical conversation history,
 * and reports material searches, citation types and cost for each.
 *
 * Why: GC 2070's interviewer searched course materials 4 times in 69 turns and
 * cited them 4 times (88 instructor citations). It reads every material's
 * digest each turn, and the instructions say not to retrieve when the digest
 * answers — but a digest cannot be cited, so material evidence ended up cited
 * as instructor testimony.
 *
 * SCRATCH ONLY: writes a temporary copy of the session into capture_messages
 * and deletes it afterwards. Refuses any database but --expect-db.
 *
 * Usage:
 *   DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch \
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs scripts/capture/replay-interview.ts \
 *     --expect-db gc_curriculum_p2_scratch --course "GC 2070" --positions 12 [--out file.json]
 *
 * Costs real model calls (capture-chat-agent's model) — two per position plus tool loops.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import type { buildAgentCall } from '@/lib/ai/agent/audit-agent';
import type { AuditResponse } from '@/lib/ai/agent/audit-response-schema';
import { loadAppEnv, isMainModule } from '@/scripts/catalog/catalog-source';
// App modules are imported inside main(), AFTER loadAppEnv(): @ai-sdk/openai's
// default provider reads OPENAI_BASE_URL when it is first imported, so a static
// import sent every call to api.openai.com instead of the campus gateway.

const RETRIEVE_SECTION_START = '## When to retrieve (and when not to)';
const RETRIEVE_SECTION_END = '## Program memory (cross-instructor — REFERENCE, never evidence)';

/** The revised section under test. Everything else in the prompt is unchanged. */
export const SEARCH_FIRST_SECTION = `## When to retrieve (and when not to)

**A digest tells you what a material contains and where to look. It is not
evidence and it cannot be cited.** Every finding that rests on what a material
says must cite the passage itself (a \`chunk\` citation from a tool result).

**Retrieve when:**

- A finding, or the question you are about to ask, rests on what a material
  says — an assignment's deliverables, a rubric criterion, a point value, an
  objective, a lab procedure. Retrieve the passage and cite it, even when the
  digest already told you the answer.
- Before asking the instructor about anything a digest says the materials
  cover (how an assignment is graded, what students submit, what a lab
  requires): retrieve it first, cite it, and ask only about what the passage
  leaves open.
- The instructor mentions a specific assignment / page / unit; verify it
  before reasoning about it.

**Do NOT retrieve when:**

- The question is about something materials cannot show — how students
  actually performed, what they explain aloud, how the instructor judges in
  practice. That is instructor knowledge.
- You would only be confirming something already cited earlier in this
  conversation — reuse that citation.
- The information is genuinely *not in the materials* — that's a finding to
  surface, not a search to run repeatedly.

`;

/** Replace the "When to retrieve" section of the current prompt; throws if it can't be found exactly once. */
export function withSearchFirstSection(prompt: string): string {
  const start = prompt.indexOf(RETRIEVE_SECTION_START);
  const end = prompt.indexOf(RETRIEVE_SECTION_END);
  if (start < 0 || end < 0 || end < start || prompt.indexOf(RETRIEVE_SECTION_START, start + 1) >= 0) {
    throw new Error('capture-chat-agent prompt: "When to retrieve" section not found exactly once');
  }
  return prompt.slice(0, start) + SEARCH_FIRST_SECTION + prompt.slice(end);
}

const MATERIAL_TOOLS = new Set(['search_materials', 'fetch_material_section', 'list_materials']);

interface ArmResult {
  materialToolCalls: number;
  otherToolCalls: number;
  chunkCitations: number;
  instructorCitations: number;
  question: string;
  costUsdCents: number;
  uncachedPromptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  error?: string;
}

/** Evenly spaced picks from a list (always includes the first and last). */
export function evenlySpaced<T>(items: T[], n: number): T[] {
  if (n >= items.length) return items;
  if (n <= 1) return items.slice(0, 1);
  return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]!);
}

async function runArm(systemPrompt: string, built: Awaited<ReturnType<typeof buildAgentCall>>): Promise<ArmResult> {
  const { getProviderForFunction } = await import('@/lib/ai/provider');
  const { AuditResponseJsonSchema, AuditResponseSchema } = await import('@/lib/ai/agent/audit-response-schema');
  const provider = await getProviderForFunction('capture-chat-agent');
  try {
    const r = await provider.completeWithTools<AuditResponse>({
      systemPrompt,
      messages: built.messages,
      tools: built.tools,
      schemaName: 'audit_response',
      jsonSchema: AuditResponseJsonSchema,
      validate: raw => AuditResponseSchema.parse(raw),
      maxToolCalls: 4,
    });
    if (r.kind !== 'response') throw new Error('agent loop did not converge');
    const cites = (r.value.citations ?? []) as Array<{ type: string }>;
    return {
      materialToolCalls: r.toolCallsUsed.filter(t => MATERIAL_TOOLS.has(t.toolName)).length,
      otherToolCalls: r.toolCallsUsed.filter(t => !MATERIAL_TOOLS.has(t.toolName)).length,
      chunkCitations: cites.filter(c => c.type === 'chunk').length,
      instructorCitations: cites.filter(c => c.type === 'instructor').length,
      question: String((r.value as { question?: unknown }).question ?? '').slice(0, 300),
      ...r.telemetry,
    };
  } catch (err) {
    return { materialToolCalls: 0, otherToolCalls: 0, chunkCitations: 0, instructorCitations: 0, question: '', costUsdCents: 0, uncachedPromptTokens: 0, cachedTokens: 0, completionTokens: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function main(argv: string[]): Promise<number> {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const expectDb = arg('--expect-db');
  const course = arg('--course');
  const positions = Number(arg('--positions') ?? '12');
  const out = arg('--out');
  if (!expectDb || !course) { console.error('usage: --expect-db <scratch db> --course <code> [--positions n] [--out file]'); return 2; }
  const { db } = await import('@/lib/db/client');
  const { captureMessages } = await import('@/lib/db/schema');
  const { buildAgentCall } = await import('@/lib/ai/agent/audit-agent');
  const { formatDbError, assertExpectedDb } = await import('@/scripts/catalog/catalog-source');
  if (!expectDb.includes('scratch')) { console.error('refusing: replay writes temporary rows and runs only against a scratch database'); return 2; }
  try { await assertExpectedDb(expectDb); } catch (err) { console.error(formatDbError(err)); return 1; }

  const rows = await db.select().from(captureMessages)
    .where(eq(captureMessages.courseCode, course))
    .orderBy(asc(captureMessages.sessionId), asc(captureMessages.turnIndex));
  const bySession = new Map<string, typeof rows>();
  for (const r of rows) bySession.set(r.sessionId, [...(bySession.get(r.sessionId) ?? []), r]);
  const [sessionId, session] = [...bySession.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!sessionId || !session) { console.error(`no capture session for ${course}`); return 1; }

  const userTurns = session.filter(r => r.role === 'user' && r.content);
  const picks = evenlySpaced(userTurns, positions);
  const { loadPrompt } = await import('@/lib/ai/prompts/load');
  const current = await loadPrompt('capture-chat-agent');
  const revised = withSearchFirstSection(current);
  console.log(`${course}: session ${sessionId.slice(0, 8)} (${session.length} rows); replaying ${picks.length} turns × 2 arms`);

  const results: Array<{ turnIndex: number; current: ArmResult; searchFirst: ArmResult }> = [];
  for (const pick of picks) {
    const tempSession = randomUUID();
    try {
      const history = await db.select().from(captureMessages)
        .where(and(eq(captureMessages.sessionId, sessionId), lt(captureMessages.turnIndex, pick.turnIndex)))
        .orderBy(asc(captureMessages.turnIndex));
      if (history.length) {
        await db.insert(captureMessages).values(history.map(h => ({ ...h, id: randomUUID(), sessionId: tempSession })));
      }
      const built = await buildAgentCall({ sessionId: tempSession, courseCode: course, userMessage: pick.content!, auditMode: 'full', includePriorSessions: false });
      const a = await runArm(current, built);
      const b = await runArm(revised, built);
      results.push({ turnIndex: pick.turnIndex, current: a, searchFirst: b });
      console.log(`turn ${String(pick.turnIndex).padStart(3)}  current: ${a.materialToolCalls} searches, ${a.chunkCitations} doc / ${a.instructorCitations} instr cites${a.error ? ' ERR ' + a.error.slice(0, 60) : ''}   search-first: ${b.materialToolCalls} searches, ${b.chunkCitations} doc / ${b.instructorCitations} instr cites${b.error ? ' ERR ' + b.error.slice(0, 60) : ''}`);
    } finally {
      await db.delete(captureMessages).where(inArray(captureMessages.sessionId, [tempSession]));
    }
  }

  const sum = (k: 'current' | 'searchFirst', f: keyof ArmResult) => results.reduce((s, r) => s + (Number(r[k][f]) || 0), 0);
  for (const k of ['current', 'searchFirst'] as const) {
    console.log(`${k.padEnd(12)} searches=${sum(k, 'materialToolCalls')} docCites=${sum(k, 'chunkCitations')} instrCites=${sum(k, 'instructorCitations')} turnsWithDocCite=${results.filter(r => r[k].chunkCitations > 0).length}/${results.length} errors=${results.filter(r => r[k].error).length} cost≈$${(sum(k, 'costUsdCents') / 10_000).toFixed(2)}`);
  }
  if (out) writeFileSync(out, JSON.stringify({ course, sessionId, results }, null, 2));
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
