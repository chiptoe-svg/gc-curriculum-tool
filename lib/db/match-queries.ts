/**
 * Skill-match judgments (the AI judge's cached probabilities) and decisions (faculty labels), migration 0069.
 * Decisions are append-only: a changed mind is a new row, and "current" means the latest per pair.
 */
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { skillMatchDecisions, skillMatchJudgments } from '@/lib/db/schema';

export type Decision = typeof skillMatchDecisions.$inferSelect;
export type NewDecision = typeof skillMatchDecisions.$inferInsert;

const pairKey = (requiredHash: string, suppliedHash: string) => `${requiredHash}|${suppliedHash}`;

export async function readJudgments(
  pairs: Array<{ requiredHash: string; suppliedHash: string }>,
  model: string,
  promptVersion: string,
): Promise<Map<string, { pFully: number; pPartly: number }>> {
  const out = new Map<string, { pFully: number; pPartly: number }>();
  if (pairs.length === 0) return out;
  const wanted = new Set(pairs.map((p) => pairKey(p.requiredHash, p.suppliedHash)));
  const rows = await db.select().from(skillMatchJudgments).where(and(
    eq(skillMatchJudgments.model, model),
    eq(skillMatchJudgments.promptVersion, promptVersion),
    inArray(skillMatchJudgments.requiredHash, [...new Set(pairs.map((p) => p.requiredHash))]),
    inArray(skillMatchJudgments.suppliedHash, [...new Set(pairs.map((p) => p.suppliedHash))]),
  ));
  for (const r of rows) {
    const k = pairKey(r.requiredHash, r.suppliedHash);
    if (wanted.has(k) && r.pFully !== null && r.pPartly !== null) out.set(k, { pFully: r.pFully, pPartly: r.pPartly });
  }
  return out;
}

export async function writeJudgments(rows: Array<{
  requiredHash: string; suppliedHash: string; model: string; promptVersion: string; pFully: number | null; pPartly: number | null;
}>): Promise<void> {
  // One INSERT cannot touch a row twice, so collapse duplicate keys first (the last one wins).
  const byKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byKey.set(`${r.requiredHash}|${r.suppliedHash}|${r.model}|${r.promptVersion}`, r);
  const unique = [...byKey.values()];
  const CHUNK = 1000;
  for (let i = 0; i < unique.length; i += CHUNK) {
    await db.insert(skillMatchJudgments).values(unique.slice(i, i + CHUNK)).onConflictDoUpdate({
      target: [skillMatchJudgments.requiredHash, skillMatchJudgments.suppliedHash, skillMatchJudgments.model, skillMatchJudgments.promptVersion],
      set: { pFully: sql`excluded.p_fully`, pPartly: sql`excluded.p_partly`, createdAt: sql`now()` },
    });
  }
}

export async function insertDecision(d: NewDecision): Promise<void> {
  await db.insert(skillMatchDecisions).values(d);
}

/** Latest decision per pair (decided_at, then id), oldest first so a later row overwrites an earlier one. */
function newestPerPair(rows: Decision[]): Map<string, Decision> {
  const out = new Map<string, Decision>();
  for (const r of rows) out.set(pairKey(r.requiredHash, r.suppliedHash), r);
  return out;
}

const oldestFirst = [asc(skillMatchDecisions.decidedAt), asc(skillMatchDecisions.id)];

/** Non-draft decisions from every plan, plus draft decisions only for `planId`. */
export async function latestDecisions(opts: { planId?: string } = {}): Promise<Map<string, Decision>> {
  const visible = opts.planId
    ? or(eq(skillMatchDecisions.draft, false), eq(skillMatchDecisions.planId, opts.planId))
    : eq(skillMatchDecisions.draft, false);
  return newestPerPair(await db.select().from(skillMatchDecisions).where(visible).orderBy(...oldestFirst));
}

/** Every decision, newest first; `latestOnly` keeps the newest per pair (drafts included: this is the research export). */
export async function exportDecisions(opts: { latestOnly: boolean }): Promise<Decision[]> {
  const rows = await db.select().from(skillMatchDecisions).orderBy(...oldestFirst);
  const kept = opts.latestOnly ? [...newestPerPair(rows).values()] : rows;
  return kept.sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime() || (a.id < b.id ? 1 : -1));
}
