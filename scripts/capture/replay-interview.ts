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
 *     [--model <id> [--effort low|medium|high]]   # override the interviewer's model for every arm
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

**A digest or a material-list entry tells you what a material contains and
where to look. It is not evidence and it cannot be cited.** Every finding that rests on what a material
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

const DIGEST_BULLET_START = '- **Per-material digests**';
const DIGEST_BULLET_END = '- **Prerequisite courses\' captured profiles**';

export const MATERIAL_LIST_BULLET = `- **Material list** — one line per included material: its title, its id and
  a one-sentence description. It tells you what exists, not what it says. Use
  \`search_materials\` or \`fetch_material_section\` to read a material before
  reasoning from it, and cite the passage you retrieved.
`;

/** Search-first section plus the material-list bullet in place of the digest bullet. */
export function withMaterialList(prompt: string): string {
  const p = withSearchFirstSection(prompt);
  const start = p.indexOf(DIGEST_BULLET_START);
  const end = p.indexOf(DIGEST_BULLET_END);
  if (start < 0 || end < start || p.indexOf(DIGEST_BULLET_START, start + 1) >= 0) {
    throw new Error('capture-chat-agent prompt: "Per-material digests" bullet not found exactly once');
  }
  return p.slice(0, start) + MATERIAL_LIST_BULLET + p.slice(end);
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

export const ARM_NAMES = ['current', 'search-first', 'list'] as const;
export type ArmName = (typeof ARM_NAMES)[number];

/** For each interviewer turn to regenerate, the instructor turn just before it. */
export function userTurnsBefore<T extends { role: string; turnIndex: number; content: string | null }>(session: T[], interviewerTurns: number[]): T[] {
  return interviewerTurns.map(t => {
    const u = session.find(r => r.turnIndex === t - 1);
    if (!u || u.role !== 'user' || !u.content) throw new Error(`turn ${t - 1} is not an instructor turn; pick an interviewer turn that follows one`);
    return u;
  });
}

/** Rebuild the agent call for a session whose last row is already the user turn (no new append), with the material list. */
async function buildAgentCallNoAppend(build: typeof buildAgentCall, sessionId: string, courseCode: string) {
  const { db } = await import('@/lib/db/client');
  const { captureMessages } = await import('@/lib/db/schema');
  // buildAgentCall appends `userMessage`; remove the appended row, then let it append again.
  const rows = await db.select().from(captureMessages).where(eq(captureMessages.sessionId, sessionId)).orderBy(asc(captureMessages.turnIndex));
  const last = rows[rows.length - 1]!;
  await db.delete(captureMessages).where(eq(captureMessages.id, last.id));
  return build({ sessionId, courseCode, userMessage: last.content!, auditMode: 'full', includePriorSessions: false, materialsView: 'index' });
}

/** Evenly spaced picks from a list (always includes the first and last). */
export function evenlySpaced<T>(items: T[], n: number): T[] {
  if (n >= items.length) return items;
  if (n <= 1) return items.slice(0, 1);
  return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]!);
}

async function runArm(systemPrompt: string, built: Awaited<ReturnType<typeof buildAgentCall>>, override?: { model?: string; reasoningEffort?: string }): Promise<ArmResult> {
  const { getProviderForFunction } = await import('@/lib/ai/provider');
  const { AuditResponseJsonSchema, AuditResponseSchema } = await import('@/lib/ai/agent/audit-response-schema');
  const provider = await getProviderForFunction('capture-chat-agent', override);
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
  const modelOverride = arg('--model') ? { model: arg('--model'), reasoningEffort: arg('--effort') } : undefined;
  const expectDb = arg('--expect-db');
  const course = arg('--course');
  const positions = Number(arg('--positions') ?? '12');
  const out = arg('--out');
  if (!expectDb || !course) { console.error('usage: --expect-db <scratch db> --course <code> [--positions n | --turns t1,t2] [--arms current,search-first,list] [--out file]'); return 2; }
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

  const picks = arg('--turns')
    ? userTurnsBefore(session, arg('--turns')!.split(',').map(Number))
    : evenlySpaced(session.filter(r => r.role === 'user' && r.content), positions);
  const armNames = (arg('--arms') ?? 'current,search-first,list').split(',') as ArmName[];
  for (const a of armNames) if (!ARM_NAMES.includes(a)) { console.error(`unknown arm ${a}; use ${ARM_NAMES.join(',')}`); return 2; }
  const { loadPrompt } = await import('@/lib/ai/prompts/load');
  const base = await loadPrompt('capture-chat-agent');
  const prompts: Record<ArmName, string> = { current: base, 'search-first': withSearchFirstSection(base), list: withMaterialList(base) };
  console.log(`${course}: session ${sessionId.slice(0, 8)} (${session.length} rows); replaying ${picks.length} turn(s) × ${armNames.join(', ')}`);

  const results: Array<{ turnIndex: number; arms: Partial<Record<ArmName, ArmResult>> }> = [];
  for (const pick of picks) {
    const tempSession = randomUUID();
    try {
      const history = await db.select().from(captureMessages)
        .where(and(eq(captureMessages.sessionId, sessionId), lt(captureMessages.turnIndex, pick.turnIndex)))
        .orderBy(asc(captureMessages.turnIndex));
      if (history.length) {
        await db.insert(captureMessages).values(history.map(h => ({ ...h, id: randomUUID(), sessionId: tempSession })));
      }
      const userMessage = pick.content!;
      const builtDigests = await buildAgentCall({ sessionId: tempSession, courseCode: course, userMessage, auditMode: 'full', includePriorSessions: false });
      // Same history and user turn for the list arm; only the materials view differs.
      // buildAgentCall appended the user turn above, so rebuild from the next turn's state.
      const builtList = armNames.includes('list')
        ? { ...builtDigests, messages: (await buildAgentCallNoAppend(buildAgentCall, tempSession, course)).messages }
        : builtDigests;
      if (argv.includes('--dry')) {
        const est = (sys: string, msgs: Array<{ content?: unknown }>) => Math.round((sys.length + msgs.reduce((n, m) => n + String(m.content ?? '').length, 0)) / 4);
        console.log(`interviewer turn ${pick.turnIndex + 1} (dry run, no model calls): ` + armNames.map(n => `${n} ≈ ${est(prompts[n], (n === 'list' ? builtList : builtDigests).messages as Array<{ content?: unknown }>)} tokens per call`).join('   '));
        continue;
      }
      const arms: Partial<Record<ArmName, ArmResult>> = {};
      for (const name of armNames) arms[name] = await runArm(prompts[name], name === 'list' ? builtList : builtDigests, modelOverride);
      results.push({ turnIndex: pick.turnIndex + 1, arms });
      console.log(`interviewer turn ${String(pick.turnIndex + 1).padStart(3)}  ` + armNames.map(n => { const a = arms[n]!; return `${n}: ${a.materialToolCalls} searches, ${a.chunkCitations} doc / ${a.instructorCitations} instr cites, ${a.uncachedPromptTokens + a.cachedTokens} tokens in${a.error ? ' ERR ' + a.error.slice(0, 60) : ''}`; }).join('   '));
    } finally {
      await db.delete(captureMessages).where(inArray(captureMessages.sessionId, [tempSession]));
    }
  }

  for (const n of armNames) {
    const rs = results.map(r => r.arms[n]!);
    const sum = (f: keyof ArmResult) => rs.reduce((s, a) => s + (Number(a[f]) || 0), 0);
    console.log(`${n.padEnd(12)} searches=${sum('materialToolCalls')} docCites=${sum('chunkCitations')} instrCites=${sum('instructorCitations')} turnsWithDocCite=${rs.filter(a => a.chunkCitations > 0).length}/${rs.length} tokensIn=${sum('uncachedPromptTokens') + sum('cachedTokens')} tokensOut=${sum('completionTokens')} errors=${rs.filter(a => a.error).length}`);
  }
  if (out) writeFileSync(out, JSON.stringify({ course, sessionId, results }, null, 2));
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
