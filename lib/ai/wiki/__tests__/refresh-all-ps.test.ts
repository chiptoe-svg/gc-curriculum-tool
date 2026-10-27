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

  describe('when only the timestamp changed', () => {
    const page = (ts: string, body: string) => `---\ntitle: Problem solving\ntimestamp: ${ts}\n---\n${body}\n`;
    const psCommit = (content: string) => ({ ...commit, pages: [{ path: 'competencies/problem-solving.md', content }] });
    const psWrites = (write: ReturnType<typeof vi.fn>) =>
      write.mock.calls.filter(c => (c[0] as typeof commit).pages[0]?.path === 'competencies/problem-solving.md');

    it('does not commit and says so', async () => {
      const { deps, write, logs } = mk(async () => psCommit(page('2026-10-27T12:00:00.000Z', 'same body')));
      deps.readPage = async () => page('2026-10-22T19:45:36.290Z', 'same body');
      const res = await runRefresh(planRefresh(inputs, {}), deps, { dryRun: false });
      expect(psWrites(write)).toHaveLength(0);
      expect(logs.some(l => l.includes('[problem-solving page]') && l.includes('unchanged'))).toBe(true);
      expect(res.failed).toBe(0);
    });

    it('still commits when the body changed', async () => {
      const { deps, write } = mk(async () => psCommit(page('2026-10-27T12:00:00.000Z', 'new body')));
      deps.readPage = async () => page('2026-10-22T19:45:36.290Z', 'old body');
      await runRefresh(planRefresh(inputs, {}), deps, { dryRun: false });
      expect(psWrites(write)).toHaveLength(1);
    });

    it('commits when there is no current page', async () => {
      const { deps, write } = mk(async () => psCommit(page('2026-10-27T12:00:00.000Z', 'body')));
      deps.readPage = async () => null;
      await runRefresh(planRefresh(inputs, {}), deps, { dryRun: false });
      expect(psWrites(write)).toHaveLength(1);
    });
  });
});
