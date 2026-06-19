/**
 * Vector-store abstraction for CourseCapture v2 ingestion.
 *
 * Stage 2a ships the in-memory backend used by tests and dev-time
 * pipeline runs. Stage 2b will add a Weaviate-backed implementation
 * with identical interface — switching backends is a one-line change
 * at the call site (typically lib/capture/finalize-extraction.ts).
 *
 * The "tenant" arg maps to a Weaviate tenant (per-course namespace:
 * coursecapture-<slug>). For in-memory tests, it's just a string key.
 */

import { cosineSimilarity } from '@/lib/ai/embeddings';
import { createWeaviateVectorStore } from './vector-store-weaviate';

export interface ChunkVectorRecord {
  id: string;
  vector: number[];
  materialId: string;
  courseCode: string;
  fileName: string;
  sectionTitle: string;
  sectionIndex: number;
  parentSectionId: string;
  text: string;
  contextBlurb: string;
  /** Provenance (set by the cross-course spine copy; empty for per-course writes). */
  uploadedAt?: string | null;
  snapshotId?: string | null;
}

export interface SectionRecord {
  id: string;
  materialId: string;
  title: string;
  index: number;
  text: string;
}

export interface SearchInput {
  queryVector: number[];
  queryText: string;        // used by Weaviate BM25 side; ignored by in-memory backend
  k: number;
  materialId?: string;
  courseCode?: string;      // cross-course spine: drill-down to one course
}

export interface SearchHit {
  id: string;
  materialId: string;
  courseCode: string;
  fileName: string;
  sectionTitle: string;
  sectionIndex: number;
  text: string;
  parentSectionId: string;
  parentSectionText: string | null;
  contextBlurb: string;
  score: number;
  uploadedAt: string | null;
  snapshotId: string | null;
}

export interface VectorStore {
  upsert(tenant: string, records: ChunkVectorRecord[]): Promise<void>;
  upsertSections(tenant: string, sections: SectionRecord[]): Promise<void>;
  deleteByMaterial(tenant: string, materialId: string): Promise<void>;
  hybridSearch(tenant: string, input: SearchInput): Promise<SearchHit[]>;
  fetchChunkById(tenant: string, chunkId: string): Promise<{
    text: string;
    fileName: string;
    sectionTitle: string;
    sectionIndex: number;
    materialId: string;
    parentSectionText: string | null;
  } | null>;
  deleteByCourse(tenant: string, courseCode: string): Promise<void>;
  listChunksByCourse(tenant: string, courseCode: string): Promise<ChunkVectorRecord[]>;
}

interface TenantState {
  chunks: Map<string, ChunkVectorRecord>;
  sections: Map<string, SectionRecord>;
}

export function createInMemoryVectorStore(): VectorStore {
  const tenants = new Map<string, TenantState>();
  const ensure = (t: string): TenantState => {
    let state = tenants.get(t);
    if (!state) {
      state = { chunks: new Map(), sections: new Map() };
      tenants.set(t, state);
    }
    return state;
  };

  return {
    async upsert(tenant, records) {
      const state = ensure(tenant);
      for (const r of records) state.chunks.set(r.id, r);
    },

    async upsertSections(tenant, sections) {
      const state = ensure(tenant);
      for (const s of sections) state.sections.set(s.id, s);
    },

    async deleteByMaterial(tenant, materialId) {
      const state = tenants.get(tenant);
      if (!state) return;
      for (const [id, c] of state.chunks) if (c.materialId === materialId) state.chunks.delete(id);
      for (const [id, s] of state.sections) if (s.materialId === materialId) state.sections.delete(id);
    },

    async hybridSearch(tenant, input) {
      const state = tenants.get(tenant);
      if (!state) return [];
      const scored: SearchHit[] = [];
      for (const c of state.chunks.values()) {
        if (input.materialId && c.materialId !== input.materialId) continue;
        if (input.courseCode && c.courseCode !== input.courseCode) continue;
        const parent = state.sections.get(c.parentSectionId) ?? null;
        scored.push({
          id: c.id,
          materialId: c.materialId,
          courseCode: c.courseCode,
          fileName: c.fileName,
          sectionTitle: c.sectionTitle,
          sectionIndex: c.sectionIndex,
          text: c.text,
          parentSectionId: c.parentSectionId,
          parentSectionText: parent?.text ?? null,
          contextBlurb: c.contextBlurb,
          score: cosineSimilarity(input.queryVector, c.vector),
          uploadedAt: c.uploadedAt ?? null,
          snapshotId: c.snapshotId ?? null,
        });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, input.k);
    },

    async deleteByCourse(tenant, courseCode) {
      const state = tenants.get(tenant);
      if (!state) return;
      for (const [id, c] of state.chunks) if (c.courseCode === courseCode) state.chunks.delete(id);
    },

    async listChunksByCourse(tenant, courseCode) {
      const state = tenants.get(tenant);
      if (!state) return [];
      return [...state.chunks.values()].filter(c => c.courseCode === courseCode);
    },

    async fetchChunkById(tenant, chunkId) {
      const state = tenants.get(tenant);
      const c = state?.chunks.get(chunkId);
      if (!c) return null;
      const parent = state?.sections.get(c.parentSectionId) ?? null;
      return {
        text: c.text,
        fileName: c.fileName,
        sectionTitle: c.sectionTitle,
        sectionIndex: c.sectionIndex,
        materialId: c.materialId,
        parentSectionText: parent?.text ?? null,
      };
    },
  };
}

export function tenantForCourse(courseCode: string): string {
  return `coursecapture-${courseCode.toLowerCase().replace(/\s+/g, '-')}`;
}

/** The single reserved tenant holding the union of all courses' chunks for
 *  cross-course search. Namespaced like tenantForCourse so prefixes match. */
export function tenantForProgram(): string {
  return 'coursecapture-program';
}

/** Construct the configured vector-store backend. Selects between the
 *  in-memory backend (test/dev default) and Weaviate via the VECTOR_STORE
 *  env var. Stage 2b adds the Weaviate option. */
export function createVectorStore(): VectorStore {
  const which = (process.env.VECTOR_STORE ?? 'in-memory').trim();
  if (which === 'weaviate') return createWeaviateVectorStore();
  if (which === 'in-memory') return createInMemoryVectorStore();
  throw new Error(`Unknown VECTOR_STORE: ${which}`);
}
