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
import type { Message, ToolCall } from '@/lib/ai/tool-use-types';
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
  /**
   * The faculty's typed turn. Omit for the **opening turn** — the agent
   * generates its first message from the at-rest context (catalog +
   * digests) alone, per the conversation rules in capture-chat-agent.md.
   * The opening synthesis isn't persisted as a fake user turn; only the
   * assistant's reply is written to capture_messages.
   */
  userMessage?: string;
  auditMode: 'full' | 'simple';
  /**
   * Auditor identity for this session. Stamped on every appended message
   * so the snapshot created from this session can inherit it. Optional;
   * sessions started before the chooser UI shipped will be null.
   */
  instructorName?: string | null;
  /**
   * When false, the agent's at-rest context skips the "prior audit
   * sessions" block — useful when a new instructor wants to audit the
   * same course without being anchored on a previous instructor's
   * findings. Default true (current behavior).
   */
  includePriorSessions?: boolean;
}

export interface AuditAgentResult {
  response: AuditResponse;
  toolCallsUsed: number;
}

interface BuiltAgentCall {
  systemPrompt: string;
  messages: Message[];
  tools: ReturnType<typeof buildAuditTools>;
  isOpeningTurn: boolean;
  userTurnIndex: number;
}

export async function buildAgentCall(input: AuditAgentInput): Promise<BuiltAgentCall> {
  const { sessionId, courseCode, userMessage, auditMode, instructorName, includePriorSessions } = input;

  const existingBeforeUser = await getSessionMessages(courseCode, sessionId);
  const isOpeningTurn = existingBeforeUser.length === 0 && !userMessage;

  const userTurnIndex = existingBeforeUser.length;
  if (!isOpeningTurn) {
    if (!userMessage) {
      throw new Error('buildAgentCall: userMessage required when continuing an existing session');
    }
    await appendMessage({
      sessionId,
      courseCode,
      turnIndex: userTurnIndex,
      role: 'user',
      content: userMessage,
      instructorName: instructorName ?? null,
    });
  }

  // Fresh-start: skip the prior-sessions block so a new instructor's
  // capture isn't anchored on whatever the previous instructor said.
  // Default is to include (preserves the historical behavior for
  // existing call sites).
  const wantPriorSessions = includePriorSessions !== false;

  const [course, materials, priorSessions] = await Promise.all([
    getCourseByCode(courseCode),
    listMaterialsByCourse(courseCode),
    wantPriorSessions ? listPriorSessionSummaries(courseCode, sessionId, 3) : Promise.resolve([]),
  ]);
  if (!course) throw new Error(`course not found: ${courseCode}`);

  const history = await getSessionMessages(courseCode, sessionId);

  const includedMaterials = materials
    .filter(m => !m.ignored && m.extractionStatus === 'ok')
    .sort((a, b) => a.fileName.localeCompare(b.fileName));

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

  const priorSessionsBlock = priorSessions.length
    ? priorSessions
        .map(s => {
          const r = s.lastAssistantReadiness as { score?: number; covered?: string[]; remaining?: string[] } | null;
          const readinessSummary = r
            ? `readiness ${r.score ?? '?'}%; covered: ${(r.covered ?? []).join(', ') || '(none)'}; remaining: ${(r.remaining ?? []).join(', ') || '(none)'}`
            : '(no readiness recorded)';
          // Render the last few conversational turns verbatim so the new
          // session inherits what faculty actually said — not just a
          // summary. Helps avoid asking the same questions twice across
          // page reloads / fresh sessions.
          const conversationBlock = s.recentTurns.length
            ? [
                'Recent turns (chronological — what faculty already told you, what you already said):',
                ...s.recentTurns.map(t => {
                  const speaker = t.role === 'user' ? 'FACULTY' : 'YOU (prior agent turn)';
                  return `  [${speaker}] ${t.content}`;
                }),
              ].join('\n')
            : '';
          return [
            `--- Session ${s.sessionId.slice(0, 8)}… (started ${s.startedAt.toISOString().slice(0, 10)}, ${s.turnCount} turns) ---`,
            `Final readiness: ${readinessSummary}`,
            conversationBlock,
          ].filter(Boolean).join('\n\n');
        })
        .join('\n\n')
    : '(none — this is the first audit session for this course)';

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
  if (isOpeningTurn) {
    messages.push({
      role: 'user',
      content:
        'Begin the audit now. Produce your opening turn per the conversation '
        + 'rules in the system prompt: three short paragraphs with blank lines '
        + 'between them — (1) one sentence on what the digests show overall, '
        + '(2) one sentence naming the single most consequential gap, '
        + 'contradiction, or missing piece (cite specific evidence by name: '
        + 'assignment, rubric criterion, point value, or objective number), '
        + 'and (3) one focused follow-up question on that same topic, ending '
        + 'with a question mark on its own line. Return the standard structured '
        + 'response shape (finding + question + citations + readiness).',
    });
  }

  const systemPrompt = await loadPrompt('capture-chat-agent');
  const tools = auditMode === 'full' ? buildAuditTools(courseCode) : [];

  return { systemPrompt, messages, tools, isOpeningTurn, userTurnIndex };
}

export interface PersistAssistantTurnInput {
  sessionId: string;
  courseCode: string;
  isOpeningTurn: boolean;
  userTurnIndex: number;
  response: AuditResponse;
  toolCallsUsed: ToolCall[];
  instructorName?: string | null;
}

export async function persistAssistantTurn(input: PersistAssistantTurnInput): Promise<void> {
  const assistantTurnIndex = input.isOpeningTurn ? 0 : input.userTurnIndex + 1;

  const toolCalls: CaptureMessageToolCall[] | undefined = input.toolCallsUsed.length
    ? input.toolCallsUsed.map(tc => ({ id: tc.id, toolName: tc.toolName, args: tc.args }))
    : undefined;

  const citations: CaptureMessageCitation[] | undefined = input.response.citations.length
    ? input.response.citations.map(c => {
        const out: CaptureMessageCitation = { type: c.type, excerpt: c.excerpt };
        if (c.chunkId) out.chunkId = c.chunkId;
        if (c.messageId) out.messageId = c.messageId;
        return out;
      })
    : undefined;

  await appendMessage({
    sessionId: input.sessionId,
    courseCode: input.courseCode,
    turnIndex: assistantTurnIndex,
    role: 'assistant',
    content: JSON.stringify(input.response),
    toolCalls,
    citations,
    instructorName: input.instructorName ?? null,
  });
}

export async function runAuditAgent(input: AuditAgentInput): Promise<AuditAgentResult> {
  const built = await buildAgentCall(input);
  const provider = await getProviderForFunction('capture-chat-agent');
  const result = await provider.completeWithTools<AuditResponse>({
    systemPrompt: built.systemPrompt,
    messages: built.messages,
    tools: built.tools,
    schemaName: 'audit_response',
    jsonSchema: AuditResponseJsonSchema,
    validate: (raw) => AuditResponseSchema.parse(raw),
    maxToolCalls: 2,
  });
  if (result.kind !== 'response') {
    throw new Error('agent loop did not converge — completeWithTools returned mid-loop tool_calls');
  }
  await persistAssistantTurn({
    sessionId: input.sessionId,
    courseCode: input.courseCode,
    isOpeningTurn: built.isOpeningTurn,
    userTurnIndex: built.userTurnIndex,
    response: result.value,
    toolCallsUsed: result.toolCallsUsed,
    instructorName: input.instructorName ?? null,
  });
  return { response: result.value, toolCallsUsed: result.toolCallsUsed.length };
}
