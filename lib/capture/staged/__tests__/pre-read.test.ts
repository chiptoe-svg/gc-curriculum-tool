import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ runPiTask: vi.fn(), listMaterialsByCourse: vi.fn(), recordSpend: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/ai/agent/pi/task', () => ({ runPiTask: h.runPiTask }));
vi.mock('@/lib/ai/agent/pi/endpoint', () => ({ piEndpointFor: vi.fn().mockResolvedValue({ baseUrl: 'u', apiKey: 'k', model: 'm', api: 'openai-completions' }) }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: h.listMaterialsByCourse }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn().mockResolvedValue({ code: 'GC 3460', title: 'Flexo', description: '', prerequisites: '', learningObjectives: [], majorProjects: [], skillsRequired: [] }),
}));
vi.mock('@/lib/ai/agent/audit-tools', () => ({
  buildAuditTools: vi.fn().mockReturnValue(['search_materials', 'fetch_material_section', 'list_materials', 'other_tool'].map(name => ({ name }))),
}));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ recordSpend: h.recordSpend }));

import { runPreRead, materialsFingerprint } from '../pre-read';
import { EvidenceMapSchema } from '../evidence-map';

const mat = (id: string, extra: Record<string, unknown> = {}) => ({
  id, fileName: `${id}.pdf`, digest: 'd', extractionStatus: 'ok', ignored: false, autoSetAside: false,
  retiredAt: null, ignoredItems: [], uploadedAt: new Date('2026-11-01T00:00:00Z'), ...extra,
});
const MAP = { summary: 's', graded_work: [], tests: [], competencies: [], assumed_skills: [], objectives: [], conflicts: [], unreadable: [] };

beforeEach(() => { vi.clearAllMocks(); h.recordSpend.mockResolvedValue(undefined);  vi.spyOn(console, 'info').mockImplementation(() => {}); });

describe('runPreRead', () => {
  it('is "none" with no model call when no included material was read', async () => {
    h.listMaterialsByCourse.mockResolvedValue([mat('a', { extractionStatus: 'failed' }), mat('b', { ignored: true })]);
    const r = await runPreRead('GC 3460');
    expect(r).toEqual({ map: null, status: 'none', fingerprint: null });
    expect(h.runPiTask).not.toHaveBeenCalled();
  });

  it('is "ready" with the parsed map and a fingerprint; only the three read tools are offered', async () => {
    h.listMaterialsByCourse.mockResolvedValue([mat('b'), mat('a')]);
    h.runPiTask.mockResolvedValue({ value: MAP, usdUnits: 1234, ms: 10 });
    const r = await runPreRead('GC 3460');
    expect(r.status).toBe('ready');
    expect(r.map).toEqual(EvidenceMapSchema.parse(MAP));
    expect(r.fingerprint).toBe(materialsFingerprint([mat('a'), mat('b')]));
    const call = h.runPiTask.mock.calls[0]![0];
    expect(call.tools.map((t: { name: string }) => t.name)).toEqual(['search_materials', 'fetch_material_section', 'list_materials']);
    expect(call.userMessage).toContain('# Material digests');
    expect(h.recordSpend).toHaveBeenCalledWith(1234);
  });

  it('is "failed" with map null when the task throws, and keeps the fingerprint', async () => {
    h.listMaterialsByCourse.mockResolvedValue([mat('a')]);
    h.runPiTask.mockRejectedValue(new Error('boom'));
    const r = await runPreRead('GC 3460');
    expect(r).toEqual({ map: null, status: 'failed', fingerprint: materialsFingerprint([mat('a')]) });
  });

  it('is "failed" when the model returns something that is not an evidence map', async () => {
    h.listMaterialsByCourse.mockResolvedValue([mat('a')]);
    h.runPiTask.mockResolvedValue({ value: { summary: 1 }, usdUnits: 0, ms: 1 });
    expect((await runPreRead('GC 3460')).status).toBe('failed');
  });

  it('aborts the task and fails after the 180 s timeout', async () => {
    vi.useFakeTimers();
    try {
      h.listMaterialsByCourse.mockResolvedValue([mat('a')]);
      let signal: AbortSignal | undefined;
      h.runPiTask.mockImplementation((i: { signal: AbortSignal }) => new Promise((_res, rej) => {
        signal = i.signal;
        i.signal.addEventListener('abort', () => rej(new Error('pi: aborted')));
      }));
      const p = runPreRead('GC 3460');
      await vi.advanceTimersByTimeAsync(180_001);
      const r = await p;
      expect(r.status).toBe('failed');
      expect(signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('fingerprint ignores order and changes when a material changes', () => {
    expect(materialsFingerprint([mat('a'), mat('b')])).toBe(materialsFingerprint([mat('b'), mat('a')]));
    expect(materialsFingerprint([mat('a')])).not.toBe(materialsFingerprint([mat('a', { uploadedAt: new Date('2026-11-02T00:00:00Z') })]));
  });
});
