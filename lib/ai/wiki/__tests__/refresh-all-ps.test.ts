import { describe, it, expect, vi } from 'vitest';
import { planRefresh, runRefresh, type RefreshDeps } from '../refresh-all';

const inputs = { snapshots: [], competencySlugs: ['a'], targetSlugs: [], hasProductiveFailure: false };
const mk = (ps?: RefreshDeps['problemSolvingCommit']): { deps: RefreshDeps; write: ReturnType<typeof vi.fn>; logs: string[] } => {
  const logs: string[] = [];
  const write = vi.fn(async () => ({ sha: 'x' }));
  return {
    logs, write,
    deps: {
      generateCourse: async () => ({ pages: [], logEntry: '' }),
      generateProgramBatch: async () => ({ pages: [], logEntry: '' }),
      write, log: l => logs.push(l), problemSolvingCommit: ps,
    },
  };
};
const commit = { pages: [{ path: 'competencies/problem-solving.md', content: 'x' }], logEntry: 'l', commitMessage: 'm' };

describe('refresh-all problem-solving hook', () => {
  it('writes the page once on a full program refresh', async () => {
    const { deps, write } = mk(async () => commit);
    await runRefresh(planRefresh(inputs, {}), deps, { dryRun: false });
    expect(write.mock.calls.filter(c => (c[0] as typeof commit).pages[0]?.path === 'competencies/problem-solving.md')).toHaveLength(1);
  });
  it('skips with a log line when the catalog has no row', async () => {
    const { deps, logs } = mk(async () => null);
    await runRefresh(planRefresh(inputs, {}), deps, { dryRun: false });
    expect(logs.some(l => l.includes('skipped'))).toBe(true);
  });
  it('does not run for --only courses', async () => {
    const ps = vi.fn(async () => commit);
    const { deps } = mk(ps);
    await runRefresh(planRefresh(inputs, { only: 'courses' }), deps, { dryRun: false });
    expect(ps).not.toHaveBeenCalled();
  });
});
