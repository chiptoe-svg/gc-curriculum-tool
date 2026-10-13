import { createHash } from 'node:crypto';

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
