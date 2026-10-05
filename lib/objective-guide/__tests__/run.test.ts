import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ASSIGNMENTS_TEXT, SYLLABUS_TEXT } from './fixtures';

const m = vi.hoisted(() => ({
  getSnapshotById: vi.fn(),
  getLatestSnapshotByCourse: vi.fn(),
  getCourseByCode: vi.fn(),
  listMaterialsByCourse: vi.fn(),
  upsertObjectiveGuide: vi.fn(),
  checkDailyCap: vi.fn(),
  generateObjectiveGuide: vi.fn(),
}));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({
  getSnapshotById: m.getSnapshotById, getLatestSnapshotByCourse: m.getLatestSnapshotByCourse,
}));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: m.getCourseByCode }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: m.listMaterialsByCourse }));
vi.mock('@/lib/db/objective-guides-queries', () => ({ upsertObjectiveGuide: m.upsertObjectiveGuide }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: m.checkDailyCap }));
vi.mock('../generate', () => ({ generateObjectiveGuide: m.generateObjectiveGuide }));

import { runObjectiveGuideForSnapshot } from '../run';

const row = (o: Record<string, unknown>) => ({
  id: 'm', fileName: 'f.pdf', isSyllabus: false, ignored: false, autoSetAside: false, retiredAt: null,
  extractedText: 'text', ignoredItems: [], ...o,
});
const GUIDE = { intro: 'i', objectives: [], checklist: [] };

beforeEach(() => {
  vi.clearAllMocks();
  m.getSnapshotById.mockResolvedValue({ id: 'snap-1', courseCode: 'MKT 4320', profile: { competencies: [] } });
  m.getLatestSnapshotByCourse.mockResolvedValue({ id: 'snap-1' });
  m.getCourseByCode.mockResolvedValue({ code: 'MKT 4320', title: 'Brand Management' });
  m.checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0, overCap: false });
  m.upsertObjectiveGuide.mockResolvedValue(undefined);
  m.generateObjectiveGuide.mockResolvedValue({
    guide: GUIDE, droppedNames: ['assignment: Capstone Pitch'], model: 'gpt-test', costUsdCents: 900, attempts: 2,
  });
});

describe('runObjectiveGuideForSnapshot', () => {
  it('never sends a set-aside syllabus to the AI', async () => {
    m.listMaterialsByCourse.mockResolvedValue([
      row({ id: 's', fileName: 'MKT 4320 syllabus.pdf', isSyllabus: true, ignored: true, autoSetAside: true, extractedText: 'SECRET SYLLABUS' }),
      row({ fileName: 'Canvas: Assignments', extractedText: ASSIGNMENTS_TEXT }),
    ]);
    const r = await runObjectiveGuideForSnapshot('snap-1');
    expect(r).toEqual({ status: 'skipped', courseCode: 'MKT 4320', reason: 'syllabus-set-aside' });
    expect(m.generateObjectiveGuide).not.toHaveBeenCalled();
    expect(m.upsertObjectiveGuide).not.toHaveBeenCalled();
  });

  it('sends only the usable syllabus and unignored assignments, then stores the guide', async () => {
    m.listMaterialsByCourse.mockResolvedValue([
      row({ id: 's1', fileName: 'old syllabus.pdf', isSyllabus: true, ignored: true, extractedText: 'SECRET' }),
      row({ id: 's2', fileName: 'syllabus.pdf', isSyllabus: true, extractedText: SYLLABUS_TEXT }),
      row({ fileName: 'Canvas: Assignments', extractedText: ASSIGNMENTS_TEXT, ignoredItems: ['Reading Quiz 1'] }),
    ]);
    const r = await runObjectiveGuideForSnapshot('snap-1');
    expect(m.generateObjectiveGuide).toHaveBeenCalledTimes(1);
    const arg = m.generateObjectiveGuide.mock.calls[0]![0];
    expect(arg.syllabi).toEqual([{ id: 's2', fileName: 'syllabus.pdf', text: SYLLABUS_TEXT }]);
    expect(JSON.stringify(arg)).not.toContain('SECRET');
    expect(arg.assignmentsText).not.toContain('Reading Quiz 1');
    expect(arg).toMatchObject({ courseCode: 'MKT 4320', courseTitle: 'Brand Management' });
    expect(m.upsertObjectiveGuide).toHaveBeenCalledWith({
      courseCode: 'MKT 4320', snapshotId: 'snap-1', guide: GUIDE, droppedNames: ['assignment: Capstone Pitch'], model: 'gpt-test',
    });
    expect(r).toEqual({ status: 'written', courseCode: 'MKT 4320', objectives: 0, droppedNames: ['assignment: Capstone Pitch'], costUsdCents: 900 });
  });

  it('does not overwrite with a guide from a snapshot that is no longer the latest', async () => {
    m.listMaterialsByCourse.mockResolvedValue([
      row({ isSyllabus: true, extractedText: SYLLABUS_TEXT }),
      row({ fileName: 'Canvas: Assignments', extractedText: ASSIGNMENTS_TEXT }),
    ]);
    m.getLatestSnapshotByCourse.mockResolvedValue({ id: 'snap-2' });
    expect(await runObjectiveGuideForSnapshot('snap-1')).toEqual({ status: 'skipped', courseCode: 'MKT 4320', reason: 'superseded' });
    expect(m.upsertObjectiveGuide).not.toHaveBeenCalled();
  });

  it('skips without a call when over the daily cap, or with no assignments', async () => {
    m.listMaterialsByCourse.mockResolvedValue([
      row({ isSyllabus: true, extractedText: SYLLABUS_TEXT }),
      row({ fileName: 'Canvas: Assignments', extractedText: ASSIGNMENTS_TEXT }),
    ]);
    m.checkDailyCap.mockResolvedValue({ ok: false, spentCents: 1, overCap: true });
    expect((await runObjectiveGuideForSnapshot('snap-1')).status).toBe('skipped');
    m.listMaterialsByCourse.mockResolvedValue([row({ isSyllabus: true, extractedText: SYLLABUS_TEXT })]);
    m.checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0, overCap: false });
    expect(await runObjectiveGuideForSnapshot('snap-1')).toEqual({ status: 'skipped', courseCode: 'MKT 4320', reason: 'no-assignments' });
    expect(m.generateObjectiveGuide).not.toHaveBeenCalled();
  });

  it('skips an unknown snapshot', async () => {
    m.getSnapshotById.mockResolvedValue(null);
    expect(await runObjectiveGuideForSnapshot('nope')).toEqual({ status: 'skipped', courseCode: null, reason: 'snapshot-not-found' });
  });
});
