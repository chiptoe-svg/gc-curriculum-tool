/**
 * Stage 3 audit-chat agent loop. Per faculty turn:
 *   1. Compute next turn_index from current session history.
 *   2. Persist the user turn into capture_messages (so it shows up
 *      in history even if the agent step fails or retries).
 *   3. Load course catalog + included material digests.
 *   4. Reload history (now including the user turn).
 *   5. Call completeWithTools — tools enabled in 'full' mode,
 *      empty in 'simple' mode.
 *   6. Parse the structured response.
 *   7. Persist the assistant turn (with citations + tool calls used).
 *   8. Return the response.
 *
 * Spec: docs/superpowers/specs/2026-05-26-coursecapture-agentic-retrieval-design.md
 *       § Phase B — Audit Chat as Agent.
 */

import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import type { Message } from '@/lib/ai/tool-use-types';
import { buildAuditTools } from './audit-tools';
import {
  AuditResponseSchema,
  AuditResponseJsonSchema,
  type AuditResponse,
} from './audit-response-schema';
import {
  appendMessage,
  getSessionMessages,
  listPriorSessionSummaries,
  type CaptureMessageToolCall,
  type CaptureMessageCitation,
} from '@/lib/db/capture-messages-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCourseByCode } from '@/lib/db/courses-queries';

export interface AuditAgentInput {
  sessionId: string;
  courseCode: string;
  userMessage: string;
  auditMode: 'full' | 'simple';
}

export interface AuditAgentResult {
  response: AuditResponse;
  toolCallsUsed: number;
}

export async function runAuditAgent(input: AuditAgentInput): Promise<AuditAgentResult> {
  const { sessionId, courseCode, userMessage, auditMode } = input;

  // 1+2. Persist the user turn at the next turn_index. Doing this BEFORE the
  // model call means the faculty's typed message is durable even if the
  // agent step throws — they'll see it on the next page load.
  const existingBeforeUser = await getSessionMessages(courseCode, sessionId);
  const userTurnIndex = existingBeforeUser.length;
  await appendMessage({
    sessionId,
    courseCode,
    turnIndex: userTurnIndex,
    role: 'user',
    content: userMessage,
  });

  // 3. Load at-rest context.
  const [course, materials, priorSessions] = await Promise.all([
    getCourseByCode(courseCode),
    listMaterialsByCourse(courseCode),
    listPriorSessionSummaries(courseCode, sessionId, 3),
  ]);
  if (!course) throw new Error(`course not found: ${courseCode}`);

  // 4. Reload history (now includes the user turn we just appended).
  const history = await getSessionMessages(courseCode, sessionId);

  // Build the at-rest digest block (sorted by fileName for stability).
  const includedMaterials = materials
    .filter(m => !m.ignored && m.extractionStatus === 'ok')
    .sort((a, b) => a.fileName.localeCompare(b.fileName));

  // The jsonb columns are typed as string[] via Drizzle $type, but cast
  // defensively in case a legacy row carries a different runtime shape.
  const learningObjectives = (course.learningObjectives ?? []) as string[];
  const majorProjects = (course.majorProjects ?? []) as string[];
  const skillsRequired = (course.skillsRequired ?? []) as string[];

  const catalogBlock = [
    `Course: ${course.code} — ${course.title}`,
    `Description: ${course.description || '(none)'}`,
    `Prerequisites: ${course.prerequisites || '(none)'}`,
    `Learning objectives: ${learningObjectives.join('; ') || '(none)'}`,
    `Major projects: ${majorProjects.join('; ') || '(none)'}`,
    `Declared incoming skills: ${skillsRequired.join('; ') || '(none)'}`,
  ].join('\n');

  const digestBlock = includedMaterials.length
    ? includedMaterials
        .map(m => `--- ${m.fileName} (id=${m.id}) ---\n${m.digest ?? '(no digest)'}`)
        .join('\n\n')
    : '(no included materials)';

  // Prior session summaries (most recent up to 3). Gives the agent enough
  // continuity to not repeat questions, without burning context on every
  // prior turn verbatim.
  const priorSessionsBlock = priorSessions.length
    ? priorSessions
        .map(s => {
          const r = s.lastAssistantReadiness as { score?: number; covered?: string[]; remaining?: string[] } | null;
          const readinessSummary = r
            ? `readiness ${r.score ?? '?'}%; covered: ${(r.covered ?? []).join(', ') || '(none)'}; remaining: ${(r.remaining ?? []).join(', ') || '(none)'}`
            : '(no readiness recorded)';
          return [
            `--- Session ${s.sessionId.slice(0, 8)}… (started ${s.startedAt.toISOString().slice(0, 10)}, ${s.turnCount} turns) ---`,
            `Final readiness: ${readinessSummary}`,
            s.lastAssistantContent ? `Last assistant turn: ${s.lastAssistantContent.slice(0, 600)}` : '',
          ].filter(Boolean).join('\n');
        })
        .join('\n\n')
    : '(none — this is the first audit session for this course)';

  // 5. Construct messages for completeWithTools.
  // First a user message with the at-rest context, then the conversation
  // history. The capture-chat-agent.md system prompt instructs the model
  // to expect this layout.
  const messages: Message[] = [
    {
      role: 'user',
      content: `# Course catalog\n\n${catalogBlock}\n\n# Material digests\n\n${digestBlock}\n\n# Prior audit sessions (most recent)\n\n${priorSessionsBlock}`,
    },
    ...history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map((m): Message => {
        if (m.role === 'assistant') {
          return {
            role: 'assistant',
            content: typeof m.content === 'string' ? m.content : null,
          };
        }
        return { role: 'user', content: m.content ?? '' };
      }),
  ];

  const systemPrompt = await loadPrompt('capture-chat-agent');
  const tools = auditMode === 'full' ? buildAuditTools(courseCode) : [];

  const provider = await getProviderForFunction('capture-chat-agent');
  const result = await provider.completeWithTools<AuditResponse>({
    systemPrompt,
    messages,
    tools,
    schemaName: 'audit_response',
    jsonSchema: AuditResponseJsonSchema,
    validate: (raw) => AuditResponseSchema.parse(raw),
    maxToolCalls: 2, // per-turn budget per spec
  });

  if (result.kind !== 'response') {
    throw new Error(
      'agent loop did not converge — completeWithTools returned mid-loop tool_calls',
    );
  }

  // 7. Persist the assistant turn.
  const assistantTurnIndex = userTurnIndex + 1;

  const toolCalls: CaptureMessageToolCall[] | undefined = result.toolCallsUsed.length
    ? result.toolCallsUsed.map(tc => ({
        id: tc.id,
        toolName: tc.toolName,
        args: tc.args,
      }))
    : undefined;

  const citations: CaptureMessageCitation[] | undefined = result.value.citations.length
    ? result.value.citations.map(c => {
        const out: CaptureMessageCitation = {
          type: c.type,
          excerpt: c.excerpt,
        };
        if (c.chunkId !== undefined) out.chunkId = c.chunkId;
        if (c.messageId !== undefined) out.messageId = c.messageId;
        return out;
      })
    : undefined;

  await appendMessage({
    sessionId,
    courseCode,
    turnIndex: assistantTurnIndex,
    role: 'assistant',
    content: JSON.stringify(result.value),
    toolCalls,
    citations,
  });

  return { response: result.value, toolCallsUsed: result.toolCallsUsed.length };
}
