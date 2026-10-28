/**
 * Interview checks (owner, 2026-10-28; from the harness spike, see
 * docs/superpowers/audits/2026-10-28-interview-harness-spike.md on branch
 * spike/interview-harness). Deterministic checks the host runs around the
 * interviewer; lib/ai/agent/audit-agent.ts applies them to every live turn.
 *
 * 1. needsMaterialSearch: the instructor's answer (or the question it answers)
 *    points at something the course files hold (an assignment, rubric, brief,
 *    a file by name), so the interviewer must search before answering. A
 *    keyword + file-name trigger: simple on purpose, it misses a rubric quoted
 *    without being named.
 * 2. checkCitations / keepValidCitations: every chunk citation must name a
 *    passage retrieved this turn or cited earlier in the session, and every
 *    instructor citation a real instructor message. A citation the model never
 *    saw is invented, so it is dropped before the turn is saved.
 */
import type { AuditResponse } from '@/lib/ai/agent/audit-response-schema';

/** The tools a required search may use. */
export const SEARCH_TOOLS = ['search_materials', 'fetch_material_section'];

// Words for graded work and the documents that define it. Generic words such as
// "project", "test" or "reading" fired on questions about teaching practice (2070-024).
const MATERIAL_WORDS = /\b(rubrics?|assignments?|brief|handouts?|syllabus|templates?|worksheets?|lab reports?|quiz(?:zes)?|exams?|deliverables?|points|grading|graded|criteria|instructions|guidelines|checklists?|submissions?|requirements?)\b/i;
// Assignment codes as courses write them: "A2", "B6", "A2–A3", "C6".
const ASSIGNMENT_CODE = /\b[A-H]\d{1,2}(?:\s*[–-]\s*[A-H]?\d{1,2})?\b/;

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

/**
 * Must the interviewer search before answering? Reads the instructor's answer
 * AND the interviewer's previous question: answers are often short ("Based on
 * final submission only") while the question names the assignment or rubric.
 */
export function needsMaterialSearch(userMessage: string | undefined, fileNames: string[], previousQuestion?: string): { required: boolean; reason?: string } {
  if (!userMessage) return { required: false };
  const text = `${previousQuestion ?? ''}\n${userMessage}`;
  const kw = text.match(MATERIAL_WORDS);
  if (kw) return { required: true, reason: `this exchange is about "${kw[0]}"` };
  const code = text.match(ASSIGNMENT_CODE);
  if (code) return { required: true, reason: `this exchange names assignment ${code[0]}` };
  const tokens = fileNameTokens(fileNames);
  const hit = text.toLowerCase().split(/[^a-z]+/).find(w => tokens.has(w));
  if (hit) return { required: true, reason: `this exchange names "${hit}", which matches a course file` };
  return { required: false };
}

/** The interviewer's last question in the session (its JSON reply's `question`). */
export function previousQuestion(messages: Array<{ role: string; content: string | null }>): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant' || !m.content) continue;
    try { return String((JSON.parse(m.content) as { question?: unknown }).question ?? '') || undefined; } catch { return undefined; }
  }
  return undefined;
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

/** The citations that pass checkCitations; used once retries run out, so no invented citation is kept. */
export function keepValidCitations<T extends Pick<AuditResponse, 'citations'>>(
  response: T,
  allowed: { retrievedThisTurn: Set<string>; history: { messageIds: Set<string>; chunkIds: Set<string> } },
): T {
  return { ...response, citations: (response.citations ?? []).filter(c => checkCitations({ citations: [c] }, allowed).length === 0) };
}
