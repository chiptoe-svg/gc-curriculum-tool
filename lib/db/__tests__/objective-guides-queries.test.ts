import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ObjectiveGuide } from '@/lib/objective-guide/schema';

const { insertValues, conflictSet, updateSet, selectLimit, scrubForRecord } = vi.hoisted(() => ({
  insertValues: vi.fn(),
  conflictSet: vi.fn(),
  updateSet: vi.fn(),
  selectLimit: vi.fn(),
  scrubForRecord: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        insertValues(v);
        return {
          onConflictDoUpdate: async (c: { set: unknown }) => {
            conflictSet(c.set);
          },
        };
      },
    }),
    update: () => ({
      set: (patch: unknown) => {
        updateSet(patch);
        return { where: vi.fn(async () => undefined) };
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
  },
}));
vi.mock('@/lib/privacy/scrub', async () => {
  const actual = await vi.importActual<typeof import('@/lib/privacy/scrub')>('@/lib/privacy/scrub');
  return { ScrubError: actual.ScrubError, scrubForRecord };
});

import { upsertObjectiveGuide, rescrubStoredObjectiveGuide } from '@/lib/db/objective-guides-queries';
import { ScrubError } from '@/lib/privacy/scrub';
import { scrubIdentifiers } from '@/lib/privacy/deterministic';

const EMAIL = 'jane.doe@g.clemson.edu';
const CUID = 'C12345678';

function dirtyGuide(): ObjectiveGuide {
  return {
    intro: `Ask ${EMAIL} first.`,
    objectives: [{
      objective: 'Plan a print job.',
      measure: 'clear',
      evidence: [{ assignment: `Project for ${CUID}`, rubric_row: null }],
      gather: `Collect the work of ${CUID}.`,
      suggestion: null,
    }],
    checklist: [{ assignment: `Project for ${CUID}`, rubric_row: `Row by ${EMAIL}` }],
  };
}

const realScrub = async (s: string) => ({ text: scrubIdentifiers(s, { keepEmails: false }), redactions: {} });

beforeEach(() => {
  insertValues.mockReset();
  conflictSet.mockReset();
  updateSet.mockReset();
  selectLimit.mockReset();
  scrubForRecord.mockReset();
  scrubForRecord.mockImplementation(realScrub);
});

const input = () => ({
  courseCode: 'GC 1010', snapshotId: 'snap-1', guide: dirtyGuide(),
  droppedNames: [`Extra credit ${EMAIL}`], model: 'gpt-test',
});

describe('upsertObjectiveGuide — scrubs before storing', () => {
  it('scrubs emails and CUIDs from every guide string and the dropped names, insert and update alike', async () => {
    await upsertObjectiveGuide(input());
    expect(scrubForRecord).toHaveBeenCalledWith(`Ask ${EMAIL} first.`, { fileName: 'objective-guide:GC 1010', isSyllabus: false });
    const values = insertValues.mock.calls[0]![0] as { guide: ObjectiveGuide; droppedNames: string[]; snapshotId: string; model: string };
    const set = conflictSet.mock.calls[0]![0] as { guide: ObjectiveGuide; droppedNames: string[] };
    for (const rec of [values, set]) {
      expect(rec.guide.intro).toBe('Ask [email] first.');
      expect(rec.guide.objectives[0]!.gather).toBe('Collect the work of [student ID].');
      expect(rec.guide.objectives[0]!.evidence[0]).toEqual({ assignment: 'Project for [student ID]', rubric_row: null });
      expect(rec.guide.objectives[0]!.measure).toBe('clear');
      expect(rec.guide.objectives[0]!.suggestion).toBeNull();
      expect(rec.guide.checklist[0]).toEqual({ assignment: 'Project for [student ID]', rubric_row: 'Row by [email]' });
      expect(rec.droppedNames).toEqual(['Extra credit [email]']);
      expect(JSON.stringify(rec)).not.toMatch(/clemson\.edu|C\d{8}/);
    }
    expect(values.snapshotId).toBe('snap-1');
    expect(values.model).toBe('gpt-test');
  });

  it('writes nothing and rejects with a text-free message when the scrub fails', async () => {
    scrubForRecord.mockImplementation(async (s: string) => {
      if (s.includes('Collect')) throw new ScrubError('privacy-scrub guard rejected chunk 1/1: length');
      return realScrub(s);
    });
    const p = upsertObjectiveGuide(input());
    await expect(p).rejects.toThrow(/objective-guide GC 1010: withheld by the privacy check \(scrub failed: privacy-scrub guard rejected chunk 1\/1: length\)/);
    const err = (await p.catch((e: unknown) => e)) as Error;
    expect(err.message).not.toMatch(/clemson|C\d{8}|Collect/);
    expect(insertValues).not.toHaveBeenCalled();
    expect(conflictSet).not.toHaveBeenCalled();
  });

  it('writes nothing when an email or CUID survives the scrub (hard check)', async () => {
    scrubForRecord.mockImplementation(async (s: string) => ({ text: s, redactions: {} }));
    const p = upsertObjectiveGuide(input());
    await expect(p).rejects.toThrow(/objective-guide GC 1010: withheld by the privacy check \(2 pattern\(s\) remain\)/);
    const err = (await p.catch((e: unknown) => e)) as Error;
    expect(err.message).not.toMatch(/clemson|C\d{8}/);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('does not leak the message of an unexpected (non-ScrubError) failure', async () => {
    scrubForRecord.mockRejectedValue(new TypeError(`bad ${EMAIL}`));
    const err = (await upsertObjectiveGuide(input()).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe('objective-guide GC 1010: withheld by the privacy check (scrub failed: TypeError)');
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe('rescrubStoredObjectiveGuide — backfill helper', () => {
  const row = () => ({ guide: dirtyGuide(), droppedNames: [`x ${CUID}`] });

  it('reports a missing row', async () => {
    selectLimit.mockResolvedValue([]);
    expect(await rescrubStoredObjectiveGuide('GC 1010', { apply: true })).toBe('missing');
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('dry-run: counts a change but writes nothing', async () => {
    selectLimit.mockResolvedValue([row()]);
    expect(await rescrubStoredObjectiveGuide('GC 1010', { apply: false })).toBe('changed');
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('apply: rewrites guide and dropped names only (snapshot, model, generatedAt kept)', async () => {
    selectLimit.mockResolvedValue([row()]);
    expect(await rescrubStoredObjectiveGuide('GC 1010', { apply: true })).toBe('changed');
    expect(updateSet).toHaveBeenCalledOnce();
    const patch = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(['droppedNames', 'guide']);
    expect(JSON.stringify(patch)).not.toMatch(/clemson\.edu|C\d{8}/);
    expect(patch.droppedNames).toEqual(['x [student ID]']);
  });

  it('leaves an already-clean row alone', async () => {
    selectLimit.mockResolvedValue([{ guide: { intro: 'Hi.', objectives: [], checklist: [] }, droppedNames: [] }]);
    expect(await rescrubStoredObjectiveGuide('GC 1010', { apply: true })).toBe('unchanged');
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('a failing row is withheld (not written)', async () => {
    selectLimit.mockResolvedValue([row()]);
    scrubForRecord.mockRejectedValue(new ScrubError('privacy-scrub call failed on chunk 1/1 (Error)'));
    expect(await rescrubStoredObjectiveGuide('GC 1010', { apply: true })).toBe('withheld');
    expect(updateSet).not.toHaveBeenCalled();
  });
});
