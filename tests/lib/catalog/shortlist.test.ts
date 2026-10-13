// @vitest-environment node
// Task 6 — pure helpers in lib/catalog/shortlist.ts: normalizeTaskText,
// taskGroupKey, groupTasks. Task groups merge O*NET task statements that
// say the same thing under different SOC codes/task ids, so each distinct
// task text is embedded exactly once.
import { describe, it, expect } from 'vitest';
import { normalizeTaskText, taskGroupKey, groupTasks, type TaskRow } from '@/lib/catalog/shortlist';

describe('normalizeTaskText', () => {
  it('lower-cases, collapses whitespace, trims, and drops one trailing period', () => {
    expect(normalizeTaskText('  Prepare  Proofs. ')).toBe('prepare proofs');
  });
});

describe('taskGroupKey', () => {
  it('is the same for differently-formatted text that normalizes the same, and is 16 hex chars', () => {
    const a = taskGroupKey('Prepare proofs.');
    const b = taskGroupKey('prepare  proofs');
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('groupTasks', () => {
  it('merges two rows with the same normalized text under different SOCs into one group with 2 members', () => {
    const rows: TaskRow[] = [
      { taskId: 't1', onetSocCode: '11-1011.00', task: 'Prepare proofs.' },
      { taskId: 't2', onetSocCode: '11-1021.00', task: 'prepare  proofs' },
    ];
    const groups = groupTasks(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(2);
  });

  it('keeps distinct texts apart', () => {
    const rows: TaskRow[] = [
      { taskId: 't1', onetSocCode: '11-1011.00', task: 'Prepare proofs.' },
      { taskId: 't2', onetSocCode: '11-1021.00', task: 'Review layouts.' },
    ];
    const groups = groupTasks(rows);
    expect(groups).toHaveLength(2);
  });

  it('orders output stably, sorted by key', () => {
    const rows: TaskRow[] = [
      { taskId: 't2', onetSocCode: '11-1021.00', task: 'Review layouts.' },
      { taskId: 't1', onetSocCode: '11-1011.00', task: 'Prepare proofs.' },
      { taskId: 't3', onetSocCode: '11-1031.00', task: 'Edit copy.' },
    ];
    const groups = groupTasks(rows);
    const keys = groups.map(g => g.key);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
  });

  it("sets the label to the first row's original text, in (onetSocCode, taskId) order", () => {
    const rows: TaskRow[] = [
      { taskId: 't2', onetSocCode: '11-1021.00', task: 'SECOND original text' },
      { taskId: 't1', onetSocCode: '11-1011.00', task: 'FIRST original text' },
    ];
    // Both normalize to distinct keys since the text differs, so test with
    // same normalized text under different SOC/taskId ordering to exercise
    // "first row" selection within one group.
    const sameTextRows: TaskRow[] = [
      { taskId: 't2', onetSocCode: '11-1021.00', task: 'FIRST-SOC original text.' },
      { taskId: 't1', onetSocCode: '11-1011.00', task: 'FIRST-SOC original text' },
    ];
    const groups = groupTasks(sameTextRows);
    expect(groups).toHaveLength(1);
    // 11-1011.00 (t1) sorts before 11-1021.00 (t2), so its original text wins.
    expect(groups[0]!.label).toBe('FIRST-SOC original text');

    // Sanity: distinct-text rows produce two groups, each labeled with its own original text.
    const distinctGroups = groupTasks(rows);
    expect(distinctGroups).toHaveLength(2);
    const labels = distinctGroups.map(g => g.label).sort();
    expect(labels).toEqual(['FIRST original text', 'SECOND original text'].sort());
  });
});
