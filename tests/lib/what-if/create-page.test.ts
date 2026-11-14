import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const order: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fn = (name: string) => vi.fn(async (...args: any[]): Promise<any> => { void args; order.push(name); return undefined; });

const getSnapshotById = fn('getSnapshotById');
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getSnapshotById: (...a: unknown[]) => getSnapshotById(...a) }));
const getCourseByCode = fn('getCourseByCode');
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: (...a: unknown[]) => getCourseByCode(...a) }));
const readWikiPage = fn('readWikiPage');
vi.mock('@/lib/wiki/git-ops', () => ({ readWikiPage: (...a: unknown[]) => readWikiPage(...a) }));
const q = {
  listWhatIfMessages: fn('listWhatIfMessages'), listActiveSubCompetencies: fn('listActiveSubCompetencies'),
  addWhatIfUsage: fn('addWhatIfUsage'), saveWhatIfPage: fn('saveWhatIfPage'),
};
vi.mock('@/lib/db/what-if-queries', () => ({
  listWhatIfMessages: (...a: unknown[]) => q.listWhatIfMessages(...a),
  listActiveSubCompetencies: (...a: unknown[]) => q.listActiveSubCompetencies(...a),
  addWhatIfUsage: (...a: unknown[]) => q.addWhatIfUsage(...a),
  saveWhatIfPage: (...a: unknown[]) => q.saveWhatIfPage(...a),
}));
const attachmentsForAi = fn('attachmentsForAi');
vi.mock('@/lib/what-if/attachments', () => ({ attachmentsForAi: (...a: unknown[]) => attachmentsForAi(...a) }));
const loadNeighbors = fn('loadWhatIfNeighborContext');
vi.mock('@/lib/what-if/neighbors', () => ({ loadWhatIfNeighborContext: (...a: unknown[]) => loadNeighbors(...a) }));
const estimateWhatIf = fn('estimateWhatIf');
vi.mock('@/lib/what-if/estimate', () => ({ estimateWhatIf: (...a: unknown[]) => estimateWhatIf(...a) }));
const computeKnockOn = fn('computeKnockOn');
vi.mock('@/lib/what-if/knock-on', () => ({ computeKnockOn: (...a: unknown[]) => computeKnockOn(...a) }));
const writeWhatIfProse = fn('writeWhatIfProse');
vi.mock('@/lib/what-if/page-prose', () => ({ writeWhatIfProse: (...a: unknown[]) => writeWhatIfProse(...a) }));
const checkDailyCap = fn('checkDailyCap');
const recordSpend = fn('recordSpend');
vi.mock('@/lib/rate-limit/daily-cap', () => ({
  checkDailyCap: (...a: unknown[]) => checkDailyCap(...a),
  recordSpend: (...a: unknown[]) => recordSpend(...a),
}));

import { createWhatIfPage } from '@/lib/what-if/create-page';
import { RATING_IN_PROSE } from '@/lib/what-if/rating-pattern';

const approved = {
  competencies: [{ statement: 'Prepare print-ready files', type: 'technical', k_depth: 3, u_depth: 2, d_depth: 3 }],
  incoming_expectations: [],
  overview: { narrative: 'The approved narrative of the course, long enough to count.' },
};
const whatIf = { id: 'w1', courseCode: 'GC 3460', baseSnapshotId: 'snap-1', title: null } as never;
const estimate = { changeItems: [], movedRatings: [], newCompetencies: [], incomingChanges: [] };
const t1 = { costUsdCents: 3, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 5, completionTokens: 6 };
const t2 = { costUsdCents: 2, durationMs: 1, cachedTokens: 1, uncachedPromptTokens: 7, completionTokens: 8 };
const prose = { description: 'd', whatChanges: 'w', neighbors: 'n', questions: ['a', 'b', 'c'] };
const knockOn = { laterCourses: [], earlierCourses: [], careerTargets: [], notComputed: [] };
const wikiPage = (description: string | null) =>
  `---\ntitle: Prepress\n${description === null ? '' : `description: "${description}"\n`}---\n\n- Prepare files (K4/U3/D3)\n`;
const ok = { ok: true, spentCents: 0, overCap: false };

beforeEach(() => {
  order.length = 0;
  [getSnapshotById, getCourseByCode, readWikiPage, ...Object.values(q), attachmentsForAi, loadNeighbors,
    estimateWhatIf, computeKnockOn, writeWhatIfProse, checkDailyCap, recordSpend].forEach(m => m.mockClear());
  getSnapshotById.mockResolvedValue({ id: 'snap-1', profile: approved, retiredAt: null });
  getCourseByCode.mockResolvedValue({ code: 'GC 3460', title: 'Prepress Technology' });
  readWikiPage.mockResolvedValue(wikiPage('One sentence about the course.'));
  q.listWhatIfMessages.mockResolvedValue([{ role: 'user', content: 'Add a lab', meta: { x: 1 } }, { role: 'assistant', content: 'Ok' }]);
  q.listActiveSubCompetencies.mockResolvedValue([{ id: 'cm', name: 'Color management' }]);
  attachmentsForAi.mockResolvedValue([
    { fileName: 'a.docx', status: 'ok', text: 'text A', truncated: false },
    { fileName: 'b.docx', status: 'ok', text: 'text B', truncated: true },
    { fileName: 'c.pdf', status: 'failed', text: null, truncated: false },
  ]);
  loadNeighbors.mockResolvedValue({ focal: {}, upstream: [], downstream: [] });
  estimateWhatIf.mockResolvedValue({ estimate, telemetry: t1 });
  computeKnockOn.mockResolvedValue(knockOn);
  writeWhatIfProse.mockResolvedValue({ prose, title: 'A title', summary: 'One line.', telemetry: t2 });
  checkDailyCap.mockResolvedValue(ok);
});

describe('createWhatIfPage', () => {
  it('refuses when the base version was withdrawn, with no AI call', async () => {
    getSnapshotById.mockResolvedValue({ id: 'snap-1', profile: approved, retiredAt: new Date() });
    expect(await createWhatIfPage(whatIf)).toEqual({ ok: false, reason: 'baseline_withdrawn' });
    expect(estimateWhatIf).not.toHaveBeenCalled();
    expect(writeWhatIfProse).not.toHaveBeenCalled();
    expect(q.saveWhatIfPage).not.toHaveBeenCalled();
  });

  it('refuses when the base version no longer exists', async () => {
    const r = await createWhatIfPage({ ...(whatIf as object), baseSnapshotId: null } as never);
    expect(r).toEqual({ ok: false, reason: 'baseline_withdrawn' });
    expect(getSnapshotById).not.toHaveBeenCalled();
    expect(estimateWhatIf).not.toHaveBeenCalled();
    expect(computeKnockOn).not.toHaveBeenCalled();
  });

  it('refuses when the snapshot row itself is gone', async () => {
    getSnapshotById.mockResolvedValue(null);
    expect(await createWhatIfPage(whatIf)).toEqual({ ok: false, reason: 'baseline_withdrawn' });
    expect(estimateWhatIf).not.toHaveBeenCalled();
  });

  it('writes the page in one save, last', async () => {
    expect(await createWhatIfPage(whatIf)).toEqual({ ok: true });
    expect(q.saveWhatIfPage).toHaveBeenCalledTimes(1);
    expect(order[order.length - 1]).toBe('saveWhatIfPage');
    expect(order.indexOf('saveWhatIfPage')).toBeGreaterThan(order.indexOf('writeWhatIfProse'));
    const spendCalls = order.filter(n => n === 'recordSpend').length;
    expect(spendCalls).toBe(2);
    expect(order.lastIndexOf('recordSpend')).toBeLessThan(order.indexOf('saveWhatIfPage'));
    const usageKinds = q.addWhatIfUsage.mock.calls.map(c => c[1]);
    expect(usageKinds).toEqual(['estimate', 'page']);
    const [id, page] = q.saveWhatIfPage.mock.calls[0]!;
    expect(id).toBe('w1');
    expect(page).toMatchObject({ title: 'A title', summary: 'One line.', estimate, knockOn, prose });
    expect(page.profile.ratings).toHaveLength(1);
  });

  it('keeps the previous page when the cap is reached after the estimate', async () => {
    checkDailyCap.mockResolvedValueOnce(ok).mockResolvedValueOnce({ ok: false, spentCents: 9, overCap: true });
    expect(await createWhatIfPage(whatIf)).toEqual({ ok: false, reason: 'daily_cap' });
    expect(q.saveWhatIfPage).not.toHaveBeenCalled();
    expect(writeWhatIfProse).not.toHaveBeenCalled();
    expect(recordSpend).toHaveBeenCalledWith(3);
    expect(q.addWhatIfUsage.mock.calls.map(c => c[1])).toEqual(['estimate']);
  });

  it('stops before any AI call when the cap is already reached', async () => {
    checkDailyCap.mockResolvedValue({ ok: false, spentCents: 9, overCap: true });
    expect(await createWhatIfPage(whatIf)).toEqual({ ok: false, reason: 'daily_cap' });
    expect(estimateWhatIf).not.toHaveBeenCalled();
  });

  it('keeps the previous page when the page text fails', async () => {
    writeWhatIfProse.mockRejectedValue(new Error('bad json'));
    expect(await createWhatIfPage(whatIf)).toEqual({ ok: false, reason: 'prose_failed' });
    expect(q.saveWhatIfPage).not.toHaveBeenCalled();
    expect(q.addWhatIfUsage.mock.calls.map(c => c[1])).toEqual(['estimate']);
  });

  it('still creates a page when nothing moved', async () => {
    expect(await createWhatIfPage(whatIf)).toEqual({ ok: true });
    const page = q.saveWhatIfPage.mock.calls[0]![1];
    expect(page.profile.ratings.every((r: { status: string }) => r.status === 'approved')).toBe(true);
  });

  it('asks for a title only the first time', async () => {
    writeWhatIfProse.mockResolvedValue({ prose, title: null, summary: 'One line.', telemetry: t2 });
    await createWhatIfPage({ ...(whatIf as object), title: 'Mine' } as never);
    expect(writeWhatIfProse.mock.calls[0]![0]).toMatchObject({ needsTitle: false });
    expect(q.saveWhatIfPage.mock.calls[0]![1].title).toBeNull();
    writeWhatIfProse.mockClear();
    await createWhatIfPage(whatIf);
    expect(writeWhatIfProse.mock.calls[0]![0]).toMatchObject({ needsTitle: true });
  });

  it('writes from the wiki description, not the whole page, so the model never sees a rating', async () => {
    await createWhatIfPage(whatIf);
    const d = writeWhatIfProse.mock.calls[0]![0].currentDescription as string;
    expect(d).toBe('One sentence about the course.');
    expect(RATING_IN_PROSE.test(d)).toBe(false);
    expect(readWikiPage).toHaveBeenCalledWith('courses/gc-3460.md');
  });

  it('falls back to the approved description when there is no wiki page', async () => {
    readWikiPage.mockResolvedValue(null);
    await createWhatIfPage(whatIf);
    expect(writeWhatIfProse.mock.calls[0]![0].currentDescription).toBe(approved.overview.narrative);
  });

  it('falls back to the approved description when the wiki page has no description', async () => {
    readWikiPage.mockResolvedValue(wikiPage(null));
    await createWhatIfPage(whatIf);
    expect(writeWhatIfProse.mock.calls[0]![0].currentDescription).toBe(approved.overview.narrative);
  });

  it('falls back to the approved description when the wiki description states a rating', async () => {
    readWikiPage.mockResolvedValue(wikiPage('Students reach D3 in proofing.'));
    await createWhatIfPage(whatIf);
    expect(writeWhatIfProse.mock.calls[0]![0].currentDescription).toBe(approved.overview.narrative);
  });

  it('removes rating tokens from the approved description when it has them too', async () => {
    getSnapshotById.mockResolvedValue({
      id: 'snap-1', retiredAt: null,
      profile: { ...approved, overview: { narrative: 'Students reach D3 in proofing.' } },
    });
    readWikiPage.mockResolvedValue(null);
    await createWhatIfPage(whatIf);
    const d = writeWhatIfProse.mock.calls[0]![0].currentDescription as string;
    expect(RATING_IN_PROSE.test(d)).toBe(false);
    expect(d).toContain('Students reach');
  });

  it('feeds the estimate the stored conversation and the usable attachments', async () => {
    await createWhatIfPage(whatIf);
    const input = estimateWhatIf.mock.calls[0]![0] as { conversation: unknown; attachments: Array<{ fileName: string; text: string }>; catalog: unknown };
    expect(input.conversation).toEqual([{ role: 'user', content: 'Add a lab' }, { role: 'assistant', content: 'Ok' }]);
    expect(input.attachments.map(a => a.fileName)).toEqual(['a.docx', 'b.docx']);
    expect(input.attachments[0]!.text).toBe('text A');
    expect(input.attachments[1]!.text).toContain('cut at the 120,000-character limit');
    expect(input.catalog).toEqual([{ id: 'cm', name: 'Color management' }]);
  });

  it('never writes to the wiki', () => {
    for (const f of ['lib/what-if/create-page.ts', 'lib/what-if/page-prose.ts']) {
      const src = readFileSync(f, 'utf8');
      const gitOps = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/lib\/wiki\/git-ops'/g)].flatMap(m => m[1]!.split(',').map(s => s.trim()));
      expect(gitOps.filter(n => n && n !== 'readWikiPage'), f).toEqual([]);
      expect(src).not.toMatch(/lib\/wiki\/(?!git-ops|markdown-helpers)/);
    }
  });
});
