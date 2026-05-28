import { z } from 'zod';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';
import { embedText } from '@/lib/ai/embeddings';
import { createVectorStore, tenantForCourse } from '@/lib/capture/vector-store';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';

/**
 * Build the three retrieval tools the audit-chat agent can invoke per turn.
 * The courseCode is closed over so the model cannot route tool calls to a
 * different course's tenant by passing a different courseCode argument.
 *
 * Spec: docs/superpowers/specs/2026-05-26-coursecapture-agentic-retrieval-design.md
 *       § Phase B — Tool surface.
 */
export function buildAuditTools(courseCode: string): ToolDefinition[] {
  const tenant = tenantForCourse(courseCode);

  const list_materials: ToolDefinition = {
    name: 'list_materials',
    description:
      'List all included materials for this course with their per-material digests. The digests are already in your at-rest context; call this only when the conversation has been long and you want a fresh inventory glance.',
    usagePolicy:
      'The digests for every included material are already in your at-rest ' +
      'context — you almost never need to call this. Call it only when the ' +
      'conversation has been long enough that you want a fresh inventory glance, ' +
      'or when the instructor mentions a material you don\'t recognize from the ' +
      'digests. Pass courseCode from session metadata.',
    inputSchema: z.object({ courseCode: z.string() }),
    async execute(_args) {
      const rows = await listMaterialsByCourse(courseCode);
      const materials = rows
        .filter(m => !m.ignored && m.extractionStatus === 'ok')
        .map(m => ({
          id: m.id,
          fileName: m.fileName,
          digest: m.digest ?? '',
          ferpaRisk: m.ferpaRisk ?? 'low',
          included: !m.ignored,
        }));
      return { materials };
    },
  };

  const fetch_material_section: ToolDefinition = {
    name: 'fetch_material_section',
    description:
      'Hybrid search within ONE specific material via vector + keyword search. Returns detail chunks with their parent-section context attached. Use when the digest mentions something and you need the precise wording or rubric criteria.',
    usagePolicy:
      'Use when you know which material has the answer and you need the precise ' +
      'wording — a rubric criterion\'s level descriptors, an objective\'s exact ' +
      'verb, an assignment\'s point allocation. Cite the returned chunk by ' +
      'chunkId in the finding. Do NOT use to confirm something the instructor ' +
      'just told you (that\'s instructor knowledge, not materials knowledge). ' +
      'Pass courseCode + materialId; default k=3 is usually enough.',
    inputSchema: z.object({
      courseCode: z.string(),
      materialId: z.string(),
      query: z.string(),
      k: z.number().int().min(1).max(8).optional(),
    }),
    async execute(args) {
      const a = args as { courseCode: string; materialId: string; query: string; k?: number };
      const store = createVectorStore();
      const queryVector = await embedText(a.query);
      try {
        const chunks = await store.hybridSearch(tenant, {
          queryVector,
          queryText: a.query,
          k: a.k ?? 3,
          materialId: a.materialId,
        });
        return { chunks };
      } catch (e) {
        // Tenant doesn't exist yet (no v2-indexed materials) — return empty results
        // rather than throwing so the agent can still produce a coherent response.
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('tenant not found') || msg.includes('tenant')) {
          return { chunks: [], note: 'No v2-indexed chunks available for this course yet.' };
        }
        throw e;
      }
    },
  };

  const search_materials: ToolDefinition = {
    name: 'search_materials',
    description:
      "Hybrid search across ALL included materials in this course. Use when the conversation surfaces a question and you don't know which material would answer it.",
    usagePolicy:
      'Use when the conversation surfaces a question and you don\'t know which ' +
      'material would answer it (open-ended; cross-material). Returns chunks ' +
      'from any included material in the course tenant. If a search returns ' +
      'nothing relevant, that\'s signal to ask the instructor, not to score ' +
      'zero. Pass courseCode + query; default k=5 is usually enough.',
    inputSchema: z.object({
      courseCode: z.string(),
      query: z.string(),
      k: z.number().int().min(1).max(10).optional(),
    }),
    async execute(args) {
      const a = args as { courseCode: string; query: string; k?: number };
      const store = createVectorStore();
      const queryVector = await embedText(a.query);
      try {
        const chunks = await store.hybridSearch(tenant, {
          queryVector,
          queryText: a.query,
          k: a.k ?? 5,
        });
        return { chunks };
      } catch (e) {
        // Tenant doesn't exist yet (no v2-indexed materials) — return empty results
        // rather than throwing so the agent can still produce a coherent response.
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('tenant not found') || msg.includes('tenant')) {
          return { chunks: [], note: 'No v2-indexed chunks available for this course yet.' };
        }
        throw e;
      }
    },
  };

  return [list_materials, fetch_material_section, search_materials];
}
