/**
 * Cached set-test verdicts (skill_set_judgments, migration 0070). One row per target text and exact pool of candidate
 * texts, model and prompt version: a changed pool is a new question. Only complete verdicts are written (a failed
 * model call throws before reaching here), so a row is never a stand-in for "the model was down". `picked` and `kept`
 * hold text hashes, not the caller's refs.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { skillSetJudgments } from '@/lib/db/schema';

export type SetJudgmentRow = { pAny: number | null; picked: string[]; kept: string[]; pTogether: number | null; pCombining: number | null };
type Key = { targetHash: string; poolHash: string; model: string; promptVersion: string };

export async function readSetJudgment(k: Key): Promise<SetJudgmentRow | null> {
  const [r] = await db.select().from(skillSetJudgments).where(and(
    eq(skillSetJudgments.targetHash, k.targetHash), eq(skillSetJudgments.poolHash, k.poolHash),
    eq(skillSetJudgments.model, k.model), eq(skillSetJudgments.promptVersion, k.promptVersion),
  ));
  return r ? { pAny: r.pAny, picked: r.picked, kept: r.kept, pTogether: r.pTogether, pCombining: r.pCombining } : null;
}

export async function writeSetJudgment(k: Key, v: SetJudgmentRow): Promise<void> {
  await db.insert(skillSetJudgments).values({ ...k, ...v }).onConflictDoUpdate({
    target: [skillSetJudgments.targetHash, skillSetJudgments.poolHash, skillSetJudgments.model, skillSetJudgments.promptVersion],
    set: { pAny: v.pAny, picked: v.picked, kept: v.kept, pTogether: v.pTogether, pCombining: v.pCombining, createdAt: new Date() },
  });
}
