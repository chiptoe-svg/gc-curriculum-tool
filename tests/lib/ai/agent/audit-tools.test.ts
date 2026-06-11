import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchHit } from '@/lib/capture/vector-store';

// --- Mock declarations (must be before imports of the module under test) ---

const mockListMaterialsByCourse = vi.fn();

vi.mock('@/lib/db/course-materials-queries', () => ({
  listMaterialsByCourse: (...a: unknown[]) => mockListMaterialsByCourse(...a),
}));

const mockEmbedText = vi.fn();

vi.mock('@/lib/ai/embeddings', () => ({
  embedText: (...a: unknown[]) => mockEmbedText(...a),
}));

const mockHybridSearch = vi.fn();

vi.mock('@/lib/capture/vector-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/capture/vector-store')>(
    '@/lib/capture/vector-store',
  );
  return {
    ...actual,
    // tenantForCourse comes from importActual — the real implementation runs
    createVectorStore: vi.fn(() => ({
      hybridSearch: mockHybridSearch,
      upsert: vi.fn(),
      upsertSections: vi.fn(),
      deleteByMaterial: vi.fn(),
    })),
  };
});

// --- Import module under test AFTER mocks are registered ---
import { buildAuditTools } from '@/lib/ai/agent/audit-tools';

// --- Helpers ---

function makeMaterial(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mat-1',
    fileName: 'syllabus.pdf',
    digest: 'A digest string',
    ferpaRisk: 'low',
    ignored: false,
    extractionStatus: 'ok',
    ...overrides,
  };
}

function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    id: 'hit-1',
    materialId: 'mat-1',
    fileName: 'syllabus.pdf',
    sectionTitle: 'Course Overview',
    sectionIndex: 0,
    text: 'This course covers...',
    parentSectionId: 'ps-1',
    parentSectionText: null,
    contextBlurb: '',
    score: 0.9,
    ...overrides,
  };
}

// --- Tests ---

describe('buildAuditTools', () => {
  const COURSE = 'GC 4800';

  beforeEach(() => {
    mockListMaterialsByCourse.mockReset();
    mockEmbedText.mockReset();
    mockHybridSearch.mockReset();
  });

  // -------------------------------------------------------------------------
  // list_materials
  // -------------------------------------------------------------------------

  describe('list_materials', () => {
    it('returns only non-ignored + extractionStatus=ok rows, projected correctly', async () => {
      mockListMaterialsByCourse.mockResolvedValue([
        makeMaterial({ id: 'mat-1', fileName: 'syllabus.pdf', digest: 'digest-a', ferpaRisk: 'low', ignored: false, extractionStatus: 'ok' }),
        makeMaterial({ id: 'mat-2', fileName: 'rubric.pdf', digest: null, ferpaRisk: 'medium', ignored: false, extractionStatus: 'ok' }),
        makeMaterial({ id: 'mat-3', fileName: 'private.pdf', digest: 'digest-c', ferpaRisk: 'high', ignored: true, extractionStatus: 'ok' }),
        makeMaterial({ id: 'mat-4', fileName: 'broken.pdf', digest: null, ferpaRisk: 'low', ignored: false, extractionStatus: 'failed' }),
      ]);

      const tools = buildAuditTools(COURSE);
      const tool = tools.find(t => t.name === 'list_materials')!;
      const result = await tool.execute({ courseCode: COURSE }) as { materials: Array<{ id: string; fileName: string; digest: string; ferpaRisk: string; included: boolean }> };

      expect(result.materials).toHaveLength(2);

      expect(result.materials[0]).toEqual({
        id: 'mat-1',
        fileName: 'syllabus.pdf',
        digest: 'digest-a',
        ferpaRisk: 'low',
        included: true,
      });

      // null digest maps to ''
      expect(result.materials[1]).toEqual({
        id: 'mat-2',
        fileName: 'rubric.pdf',
        digest: '',
        ferpaRisk: 'medium',
        included: true,
      });
    });

    it('calls listMaterialsByCourse with the closed-over courseCode', async () => {
      mockListMaterialsByCourse.mockResolvedValue([]);
      const tools = buildAuditTools(COURSE);
      const tool = tools.find(t => t.name === 'list_materials')!;
      await tool.execute({ courseCode: COURSE });
      expect(mockListMaterialsByCourse).toHaveBeenCalledWith(COURSE);
    });

    it('input schema accepts { courseCode }', () => {
      const tools = buildAuditTools(COURSE);
      const tool = tools.find(t => t.name === 'list_materials')!;
      expect(() => tool.inputSchema.parse({ courseCode: 'GC 4800' })).not.toThrow();
    });

    it('input schema rejects empty object', () => {
      const tools = buildAuditTools(COURSE);
      const tool = tools.find(t => t.name === 'list_materials')!;
      expect(() => tool.inputSchema.parse({})).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // fetch_material_section
  // -------------------------------------------------------------------------

  describe('fetch_material_section', () => {
    it('calls embedText then hybridSearch with materialId and default k=3', async () => {
      const fakeVector = [0.1, 0.2, 0.3];
      const fakeHits = [makeHit()];
      mockEmbedText.mockResolvedValue(fakeVector);
      mockHybridSearch.mockResolvedValue(fakeHits);

      const tools = buildAuditTools(COURSE);
      const tool = tools.find(t => t.name === 'fetch_material_section')!;
      const result = await tool.execute({
        courseCode: COURSE,
        materialId: 'mat-1',
        query: 'grading policy',
      }) as { chunks: SearchHit[] };

      expect(mockEmbedText).toHaveBeenCalledWith('grading policy');
      expect(mockHybridSearch).toHaveBeenCalledWith(
        'coursecapture-gc-4800',
        {
          queryVector: fakeVector,
          queryText: 'grading policy',
          k: 3,
          materialId: 'mat-1',
        },
      );
      expect(result.chunks).toBe(fakeHits);
    });

    it('passes custom k to hybridSearch', async () => {
      mockEmbedText.mockResolvedValue([0.1]);
      mockHybridSearch.mockResolvedValue([]);

      const tools = buildAuditTools(COURSE);
      const tool = tools.find(t => t.name === 'fetch_material_section')!;
      await tool.execute({
        courseCode: COURSE,
        materialId: 'mat-1',
        query: 'attendance',
        k: 7,
      });

      expect(mockHybridSearch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ k: 7 }),
      );
    });

    it('uses the closed-over courseCode for the tenant even if args.courseCode differs', async () => {
      mockEmbedText.mockResolvedValue([0.1]);
      mockHybridSearch.mockResolvedValue([]);

      const tools = buildAuditTools('GC 4800');
      const tool = tools.find(t => t.name === 'fetch_material_section')!;

      // Pass a different courseCode in args — security boundary must hold
      await tool.execute({
        courseCode: 'GC 0000',
        materialId: 'mat-x',
        query: 'test',
      });

      // Tenant must be derived from the closure's 'GC 4800', not 'GC 0000'
      expect(mockHybridSearch).toHaveBeenCalledWith(
        'coursecapture-gc-4800',
        expect.any(Object),
      );
    });
  });

  // -------------------------------------------------------------------------
  // search_materials
  // -------------------------------------------------------------------------

  describe('search_materials', () => {
    it('calls hybridSearch WITHOUT materialId and with default k=5', async () => {
      const fakeVector = [0.5, 0.6];
      const fakeHits = [makeHit(), makeHit({ id: 'hit-2' })];
      mockEmbedText.mockResolvedValue(fakeVector);
      mockHybridSearch.mockResolvedValue(fakeHits);

      const tools = buildAuditTools(COURSE);
      const tool = tools.find(t => t.name === 'search_materials')!;
      const result = await tool.execute({
        courseCode: COURSE,
        query: 'project deliverables',
      }) as { chunks: SearchHit[] };

      expect(mockHybridSearch).toHaveBeenCalledWith(
        'coursecapture-gc-4800',
        {
          queryVector: fakeVector,
          queryText: 'project deliverables',
          k: 5,
        },
      );
      // materialId must NOT be present
      const callArg = mockHybridSearch.mock.calls[0]![1] as Record<string, unknown>;
      expect(callArg).not.toHaveProperty('materialId');
      expect(result.chunks).toBe(fakeHits);
    });

    it('input schema rejects k > 10', () => {
      const tools = buildAuditTools(COURSE);
      const tool = tools.find(t => t.name === 'search_materials')!;
      expect(() =>
        tool.inputSchema.parse({ courseCode: COURSE, query: 'something', k: 11 }),
      ).toThrow();
    });

    it('input schema accepts k = 10', () => {
      const tools = buildAuditTools(COURSE);
      const tool = tools.find(t => t.name === 'search_materials')!;
      expect(() =>
        tool.inputSchema.parse({ courseCode: COURSE, query: 'something', k: 10 }),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // program-memory tools (cross-instructor, read-only) — added 2026-06-11
  // -------------------------------------------------------------------------

  describe('program-memory tools', () => {
    it('includes the 4 read-only program tools alongside the 3 material tools', () => {
      const names = buildAuditTools(COURSE).map(t => t.name).sort();
      expect(names).toEqual([
        'coverage_for_target',
        'fetch_material_section',
        'list_materials',
        'prereq_chain',
        'read_wiki',
        'search_materials',
        'search_wiki',
      ]);
    });
  });
});
