/**
 * Interview controls (harness spike, 2026-10-28). Deterministic checks the
 * host runs around the interviewer, whatever loop drives it (Pi, Codex).
 * The loop turns a failed check into a follow-up instruction and lets the
 * model try again, at most MAX_CONTROL_RETRIES times per turn.
 *
 * 1. needsMaterialSearch: the instructor's answer points at something the
 *    course files hold (an assignment, rubric, brief, a file by name), so the
 *    interviewer must search before answering. Keyword + file-name match: a
 *    deliberately simple trigger to see how the control attaches, not a final rule.
 * 2. checkCitations: every chunk citation must name a passage retrieved this
 *    turn or cited earlier in the session, and every instructor citation must
 *    name a real instructor message. A citation the model never saw is invented.
 */
import type { AuditResponse } from '@/lib/ai/agent/audit-response-schema';

export const MAX_CONTROL_RETRIES = 2;
export const MATERIAL_TOOLS = new Set(['search_materials', 'fetch_material_section', 'list_materials']);

const MATERIAL_WORDS = /\b(rubric|rubrics|assignment|assignments|brief|handout|syllabus|template|worksheet|lab report|project|projects|quiz|quizzes|exam|exams|test|deliverable|deliverables|points|grading|graded|criteria|instructions|guidelines|checklist|lecture|slides|reading)\b/i;

// Everyday words that show up in file names but say nothing about which file is meant.
const COMMON_WORDS = new Set(['about', 'after', 'their', 'there', 'these', 'those', 'which', 'would', 'could', 'should', 'where', 'while', 'using', 'student', 'students', 'class', 'notes', 'guide', 'other', 'first', 'second', 'third', 'final', 'introduction', 'overview', 'general', 'information', 'example', 'examples', 'sample', 'samples', 'image', 'images', 'print', 'printing', 'design', 'color']);

/** Distinctive words from file names (≥ 4 letters, not generic), lowercased. */
function fileNameTokens(fileNames: string[]): Set<string> {
  const generic = new Set(['docx', 'pdf', 'pptx', 'xlsx', 'final', 'copy', 'draft', 'version', 'fall', 'spring', 'summer', 'course', 'class', 'week', 'file', 'document', 'graphic', 'communications']);
  const out = new Set<string>();
  for (const f of fileNames) {
    for (const w of f.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z]+/)) {
      if (w.length >= 5 && !generic.has(w) && !COMMON_WORDS.has(w)) out.add(w);
    }
  }
  return out;
}

export function needsMaterialSearch(userMessage: string | undefined, fileNames: string[]): { required: boolean; reason?: string } {
  if (!userMessage) return { required: false };
  const kw = userMessage.match(MATERIAL_WORDS);
  if (kw) return { required: true, reason: `the instructor mentioned "${kw[0]}"` };
  const tokens = fileNameTokens(fileNames);
  const hit = userMessage.toLowerCase().split(/[^a-z]+/).find(w => tokens.has(w));
  if (hit) return { required: true, reason: `the instructor named "${hit}", which matches a course file` };
  return { required: false };
}

/** Message ids and chunk ids a model may legitimately cite, from the session so far. */
export function citableFromHistory(messages: Array<{ role: string; content: string | null }>): { messageIds: Set<string>; chunkIds: Set<string> } {
  const messageIds = new Set<string>();
  const chunkIds = new Set<string>();
  for (const m of messages) {
    if (!m.content) continue;
    if (m.role === 'user') {
      const id = m.content.match(/^\[messageId=([^\]]+)\]/)?.[1];
      if (id) messageIds.add(id);
    } else if (m.role === 'assistant') {
      try {
        const parsed = JSON.parse(m.content) as { citations?: Array<{ chunkId?: string | null }> };
        for (const c of parsed.citations ?? []) if (c.chunkId) chunkIds.add(c.chunkId);
      } catch { /* not JSON: nothing citable */ }
    }
  }
  return { messageIds, chunkIds };
}

/** Collect every chunkId that appears in tool results (search/fetch return chunk arrays). */
export function chunkIdsInToolResult(result: unknown, into: Set<string>): void {
  if (Array.isArray(result)) { for (const r of result) chunkIdsInToolResult(r, into); return; }
  if (result && typeof result === 'object') {
    const o = result as Record<string, unknown>;
    if (typeof o.chunkId === 'string') into.add(o.chunkId);
    // Search hits (SearchHit in lib/capture/vector-store.ts) carry the chunk id as `id`.
    if (typeof o.id === 'string' && typeof o.materialId === 'string') into.add(o.id);
    for (const v of Object.values(o)) if (v && typeof v === 'object') chunkIdsInToolResult(v, into);
  }
}

export function checkCitations(
  response: Pick<AuditResponse, 'citations'>,
  allowed: { retrievedThisTurn: Set<string>; history: { messageIds: Set<string>; chunkIds: Set<string> } },
): string[] {
  const problems: string[] = [];
  for (const c of response.citations ?? []) {
    if (c.type === 'chunk') {
      if (!c.chunkId) problems.push('a chunk citation has no chunkId');
      else if (!allowed.retrievedThisTurn.has(c.chunkId) && !allowed.history.chunkIds.has(c.chunkId)) {
        problems.push(`chunkId ${c.chunkId} was not retrieved this turn or cited earlier — retrieve the passage or drop the citation`);
      }
    } else if (c.type === 'instructor') {
      if (!c.messageId) problems.push('an instructor citation has no messageId');
      else if (!allowed.history.messageIds.has(c.messageId)) problems.push(`messageId ${c.messageId} is not an instructor message in this conversation`);
    }
  }
  return problems;
}

/** The follow-up text the loop sends when a check fails. */
export function controlFollowUp(kind: 'search' | 'citations', detail: string | string[]): string {
  if (kind === 'search') {
    return `Before answering: ${detail}. Search the course materials (search_materials or fetch_material_section) for it, cite the passage you find, and then give your answer. If the materials truly don't cover it, say so in the finding.`;
  }
  return `Your answer has citation problems:\n- ${(detail as string[]).join('\n- ')}\nFix them and give your answer again.`;
}
