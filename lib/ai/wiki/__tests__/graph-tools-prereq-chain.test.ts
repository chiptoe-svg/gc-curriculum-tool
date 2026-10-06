import { describe, it, expect, vi, beforeEach } from 'vitest';
import { courses as coursesTable, courseCatalogEntries, courseCatalogPrereqs } from '@/lib/db/schema';

vi.mock('@/lib/db/prerequisite-edge-queries', () => ({ listEdgePairs: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/db/program-coverage-queries', () => ({ getMatrixData: vi.fn() }));
const state = vi.hoisted(() => ({ catalog: true }));
const sheetRows = [
  { code: 'GC 1040', prerequisites: '' },
  { code: 'GC 2070', prerequisites: 'GC 1040' },
  { code: 'GC 3460', prerequisites: 'GC 1040' },
  { code: 'GC 3500', prerequisites: '' },
  { code: 'GC 4060', prerequisites: 'GC 3460' },
  { code: 'GC 4070', prerequisites: 'GC 3460, GC 4060' },
  { code: 'GC 4400', prerequisites: 'GC 3460' },
];
const y = '2026-2027';
const entries = ['GC 1040', 'GC 2070', 'GC 3460', 'GC 3500', 'GC 4060', 'GC 4070', 'GC 4400'].map(courseCode => ({ courseCode, catalogYear: y }));
const edges = [
  { courseCode: 'GC 2070', prereqCode: 'GC 1040', kind: 'prereq', anyOfGroup: null, catalogYear: y },
  { courseCode: 'GC 3460', prereqCode: 'GC 2070', kind: 'prereq', anyOfGroup: null, catalogYear: y },
  { courseCode: 'GC 3460', prereqCode: 'GC 3461', kind: 'coreq', anyOfGroup: null, catalogYear: y },
  { courseCode: 'GC 4060', prereqCode: 'GC 2070', kind: 'prereq', anyOfGroup: null, catalogYear: y },
  { courseCode: 'GC 4060', prereqCode: 'GC 3500', kind: 'prereq', anyOfGroup: null, catalogYear: y },
  { courseCode: 'GC 4060', prereqCode: 'GC 3460', kind: 'concurrent_ok', anyOfGroup: null, catalogYear: y },
  { courseCode: 'GC 4070', prereqCode: 'GC 4060', kind: 'prereq', anyOfGroup: null, catalogYear: y },
  { courseCode: 'GC 4400', prereqCode: 'GC 2070', kind: 'prereq', anyOfGroup: null, catalogYear: y },
  { courseCode: 'GC 4400', prereqCode: 'GC 3500', kind: 'prereq', anyOfGroup: null, catalogYear: y },
  { courseCode: 'GC 4400', prereqCode: 'GC 3460', kind: 'concurrent_ok', anyOfGroup: null, catalogYear: y },
];
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: async (t: unknown) => {
        if (t === coursesTable) return sheetRows;
        if (!state.catalog) throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
        return t === courseCatalogEntries ? entries : t === courseCatalogPrereqs ? edges : [];
      },
    }),
  },
}));

import { prereqChainTool } from '@/lib/ai/wiki/graph-tools';

type Out = {
  directPrereqs: string[]; allUpstreamPrereqs: string[]; requiredBy: string[];
  prerequisiteSource: string;
  directPrereqDetails: Array<{ code: string; relation: string; anyOfGroup: number | null; source: string }>;
};

describe('prereq_chain', () => {
  beforeEach(() => { state.catalog = true; });
  it("returns GC 3460's catalog neighbors: GC 2070 before it; GC 4060 + GC 4400 take it before or alongside", async () => {
    const out = await prereqChainTool.execute({ courseCode: 'GC 3460' }) as Out;
    expect(out.directPrereqs).toEqual(['GC 2070']);
    expect([...out.allUpstreamPrereqs].sort()).toEqual(['GC 1040', 'GC 2070']);
    expect([...out.requiredBy].sort()).toEqual(['GC 4060', 'GC 4400']);
    expect(out.prerequisiteSource).toBe('Clemson catalog 2026–27');
    expect(out.directPrereqDetails).toEqual([{ code: 'GC 2070', relation: 'prerequisite', anyOfGroup: null, source: 'Clemson catalog 2026–27' }]);
  });
  it('marks a "before or alongside" prerequisite in the details', async () => {
    const out = await prereqChainTool.execute({ courseCode: 'GC 4060' }) as Out;
    expect(out.directPrereqDetails.find(d => d.code === 'GC 3460')!.relation).toBe('before or alongside (prerequisite or concurrent enrollment)');
  });
  it('falls back to the course sheet before the catalog tables exist', async () => {
    state.catalog = false;
    const out = await prereqChainTool.execute({ courseCode: 'GC 3460' }) as Out;
    expect(out.directPrereqs).toEqual(['GC 1040']);
    expect([...out.requiredBy].sort()).toEqual(['GC 4060', 'GC 4070', 'GC 4400']);
    expect(out.prerequisiteSource).toBe('course sheet');
  });
});
