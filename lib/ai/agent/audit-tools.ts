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
      const chunks = await store.hybridSearch(tenant, {
        queryVector,
        queryText: a.query,
        k: a.k ?? 3,
        materialId: a.materialId,
      });
      return { chunks };
    },
  };

  const search_materials: ToolDefinition = {
    name: 'search_materials',
    description:
      "Hybrid search across ALL included materials in this course. Use when the conversation surfaces a question and you don't know which material would answer it.",
    inputSchema: z.object({
      courseCode: z.string(),
      query: z.string(),
      k: z.number().int().min(1).max(10).optional(),
    }),
    async execute(args) {
      const a = args as { courseCode: string; query: string; k?: number };
      const store = createVectorStore();
      const queryVector = await embedText(a.query);
      const chunks = await store.hybridSearch(tenant, {
        queryVector,
        queryText: a.query,
        k: a.k ?? 5,
      });
      return { chunks };
    },
  };

  return [list_materials, fetch_material_section, search_materials];
}
