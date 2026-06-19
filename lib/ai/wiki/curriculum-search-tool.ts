import { z } from 'zod';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';
import type { SearchHit } from '@/lib/capture/vector-store';
import { createVectorStore, tenantForProgram } from '@/lib/capture/vector-store';
import { embedText } from '@/lib/ai/embeddings';

/** Comparison mode: keep at most `perCourse` highest-scoring hits per course,
 *  preserving overall descending-score order. A verbose course can't crowd out
 *  the comparison. Assumes `hits` is already score-sorted (Weaviate returns it so). */
export function diversifyByCourse(hits: SearchHit[], perCourse: number): SearchHit[] {
  const seen = new Map<string, number>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    const n = seen.get(h.courseCode) ?? 0;
    if (n >= perCourse) continue;
    seen.set(h.courseCode, n + 1);
    out.push(h);
  }
  return out;
}

export const curriculumSearchTool: ToolDefinition = {
  name: 'search_curriculum',
  description:
    'Semantic search over the ACTUAL course materials (syllabi, assignments, rubrics, slide content) across ALL courses at once — the primary-source evidence, not the curated wiki prose and not the KUD scores. Use it to "show me / compare what courses actually do." Pass `courseCode` to drill into one course; pass `perCourse:true` to compare across courses (returns the top hits per course so a verbose course cannot dominate). Each hit cites its course + file. Prefer this over search_wiki when the user wants real material evidence or a cross-course comparison.',
  usagePolicy:
    'Free-text query. Returns primary-source excerpts grouped/diversified by course, each with courseCode + fileName for citation. Distinct from search_wiki (curated prose) and coverage_for_target (structured scores).',
  inputSchema: z.object({
    query: z.string().min(1),
    courseCode: z.string().optional(),
    perCourse: z.boolean().optional(),
    k: z.number().int().positive().max(50).optional(),
  }),
  async execute(args) {
    const { query, courseCode, perCourse, k } = args as
      { query: string; courseCode?: string; perCourse?: boolean; k?: number };
    const store = createVectorStore();
    const queryVector = await embedText(query);
    const limit = perCourse ? Math.min((k ?? 8) * 6, 50) : (k ?? 8);
    const raw = await store.hybridSearch(tenantForProgram(), { queryVector, queryText: query, k: limit, courseCode });
    const hits = perCourse ? diversifyByCourse(raw, 3).slice(0, (k ?? 8) * 3) : raw;
    return {
      hits: hits.map(h => ({
        courseCode: h.courseCode, materialId: h.materialId, fileName: h.fileName,
        sectionTitle: h.sectionTitle, chunkId: h.id, text: h.text,
        contextBlurb: h.contextBlurb, uploadedAt: h.uploadedAt, score: h.score,
      })),
    };
  },
};

export function buildCurriculumSearchTools(): ToolDefinition[] {
  return [curriculumSearchTool];
}
