import { createHash } from 'node:crypto';
import { cosineSimilarity } from '@/lib/ai/embeddings';

/**
 * Task 6 — groups O*NET task statements that say the same thing under
 * different SOC codes/task ids, so each distinct task text is embedded
 * exactly once rather than once per (release, soc, taskId) row. See
 * docs/superpowers/sdd/2026-10-13-competency-catalog-p2/task-6-brief.md.
 */

export interface TaskRow { taskId: string; onetSocCode: string; task: string }
export interface TaskGroup { key: string; label: string; members: Array<{ taskId: string; onetSocCode: string }> }

export function normalizeTaskText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

export function taskGroupKey(text: string): string {
  return createHash('sha256').update(normalizeTaskText(text), 'utf8').digest('hex').slice(0, 16);
}

export function groupTasks(rows: TaskRow[]): TaskGroup[] {
  const sorted = [...rows].sort((a, b) => a.onetSocCode.localeCompare(b.onetSocCode) || a.taskId.localeCompare(b.taskId));
  const byKey = new Map<string, TaskGroup>();
  for (const r of sorted) {
    const key = taskGroupKey(r.task);
    const g = byKey.get(key);
    if (g) g.members.push({ taskId: r.taskId, onetSocCode: r.onetSocCode });
    else byKey.set(key, { key, label: r.task, members: [{ taskId: r.taskId, onetSocCode: r.onetSocCode }] });
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Task 7 — the top-k task-group shortlist for one bundle card, by cosine
 * similarity between the card vector and each grouped task's vector.
 * Descending score; exact ties broken by key ascending (deterministic —
 * Ruling 4: the AI's top-25 for a sampled bundle must equal the first 25 of
 * the stored top-50, so ties must never depend on Map iteration order).
 * `cosineSimilarity` throws on a vector-length mismatch rather than
 * silently skipping, so a bad vector surfaces here as a thrown error.
 */
export interface ShortlistEntry { key: string; score: number; rank: number }

export function shortlistTasks(cardVector: number[], taskVectors: Map<string, number[]>, k: number): ShortlistEntry[] {
  const scored = [...taskVectors.entries()].map(([key, v]) => ({ key, score: cosineSimilarity(cardVector, v) }));
  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return scored.slice(0, k).map((s, i) => ({ ...s, rank: i + 1 }));
}
