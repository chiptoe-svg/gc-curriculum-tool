import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, CompleteWithToolsResult } from '@/lib/ai/tool-use-types';
import type { AuditResponse } from '@/lib/ai/agent/audit-response-schema';

// --- Mocks (declared before importing module under test) ---

const mockAppendMessage = vi.fn();
const mockGetSessionMessages = vi.fn();
const mockListPriorSessionSummaries = vi.fn(async () => []);

vi.mock('@/lib/db/capture-messages-queries', () => ({
  appendMessage: (...a: unknown[]) => mockAppendMessage(...a),
  getSessionMessages: (...a: unknown[]) => mockGetSessionMessages(...a),
  listPriorSessionSummaries: (...a: unknown[]) => mockListPriorSessionSummaries(...a),
}));

const mockGetCourseByCode = vi.fn();

vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: (...a: unknown[]) => mockGetCourseByCode(...a),
}));

const mockListMaterialsByCourse = vi.fn();

vi.mock('@/lib/db/course-materials-queries', () => ({
  listMaterialsByCourse: (...a: unknown[]) => mockListMaterialsByCourse(...a),
}));

const mockCompleteWithTools = vi.fn();
const mockGetProviderForFunction = vi.fn(async () => ({
  name: 'fake',
  model: 'fake',
  completeWithTools: mockCompleteWithTools,
  complete: vi.fn(),
  transcribeDocument: vi.fn(),
}));

vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: (...a: unknown[]) => mockGetProviderForFunction(...(a as [])),
}));

const mockLoadPrompt = vi.fn(async () => 'SYSTEM PROMPT TEXT');

vi.mock('@/lib/ai/prompts/load', () => ({
  loadPrompt: (...a: unknown[]) => mockLoadPrompt(...(a as [])),
}));

const mockBuildAuditTools = vi.fn(() => [
  {
    name: 'list_materials',
    description: 'desc',
    inputSchema: { parse: (v: unknown) => v },
    execute: async () => ({}),
  },
  {
    name: 'fetch_material_section',
    description: 'desc',
    inputSchema: { parse: (v: unknown) => v },
    execute: async () => ({}),
  },
  {
    name: 'search_materials',
    description: 'desc',
    inputSchema: { parse: (v: unknown) => v },
    execute: async () => ({}),
  },
]);

vi.mock('@/lib/ai/agent/audit-tools', () => ({
  buildAuditTools: (...a: unknown[]) => mockBuildAuditTools(...(a as [])),
}));

// --- Import module under test AFTER mocks are registered ---
import { runAuditAgent } from '@/lib/ai/agent/audit-agent';

// --- Helpers ---

function makeCourse(overrides: Record<string, unknown> = {}) {
  return {
    code: 'GC 4800',
    title: 'Capstone Studio',
    description: 'A capstone',
    prerequisites: 'GC 3400',
    learningObjectives: ['LO1', 'LO2'],
    majorProjects: ['Project A'],
    skillsRequired: ['skill-x'],
    ...overrides,
  };
}

function makeMaterial(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mat-1',
    fileName: 'syllabus.pdf',
    digest: 'a digest',
    ferpaRisk: 'low',
    ignored: false,
    extractionStatus: 'ok',
    courseCode: 'GC 4800',
    ...overrides,
  };
}

function makeAuditResponse(overrides: Partial<AuditResponse> = {}): AuditResponse {
  return {
    finding: 'Some finding text.',
    question: 'What about X?',
    citations: [
      { type: 'chunk', chunkId: 'chunk-1', excerpt: 'an excerpt' },
    ],
    readiness: {
      score: 50,
      covered: ['outcomes'],
      remaining: ['projects'],
      good_enough_to_generate: false,
    },
    ...overrides,
  };
}

function makeResponseResult(value: AuditResponse, toolCalls: Array<{ id: string; toolName: string; args: Record<string, unknown> }> = []): CompleteWithToolsResult<AuditResponse> {
  return {
    kind: 'response',
    value,
    toolCallsUsed: toolCalls,
    telemetry: {
      costUsdCents: 0,
      durationMs: 0,
      cachedTokens: 0,
      uncachedPromptTokens: 0,
      completionTokens: 0,
    },
  };
}

beforeEach(() => {
  mockAppendMessage.mockReset();
  mockAppendMessage.mockResolvedValue(undefined);
  mockGetSessionMessages.mockReset();
  mockGetCourseByCode.mockReset();
  mockListMaterialsByCourse.mockReset();
  mockCompleteWithTools.mockReset();
  mockBuildAuditTools.mockClear();
  mockLoadPrompt.mockClear();
});

describe('runAuditAgent', () => {
  const COURSE = 'GC 4800';
  const SESSION = 'sess-1';

  // -----------------------------------------------------------------------
  // 1. Happy path
  // -----------------------------------------------------------------------
  it('returns a valid AuditResponse and persists the assistant turn with citations + toolCalls', async () => {
    mockGetSessionMessages.mockResolvedValueOnce([]); // before user persist
    mockGetSessionMessages.mockResolvedValueOnce([
      { role: 'user', content: 'hello', turnIndex: 0 },
    ]); // after user persist

    mockGetCourseByCode.mockResolvedValue(makeCourse());
    mockListMaterialsByCourse.mockResolvedValue([makeMaterial()]);

    const value = makeAuditResponse();
    mockCompleteWithTools.mockResolvedValue(
      makeResponseResult(value, [
        { id: 'tc-1', toolName: 'list_materials', args: { courseCode: COURSE } },
      ]),
    );

    const result = await runAuditAgent({
      sessionId: SESSION,
      courseCode: COURSE,
      userMessage: 'hello',
      auditMode: 'full',
    });

    expect(result.response).toEqual(value);
    expect(result.toolCallsUsed).toBe(1);

    // appendMessage called twice — user then assistant
    expect(mockAppendMessage).toHaveBeenCalledTimes(2);
    const [userCall, assistantCall] = mockAppendMessage.mock.calls;
    expect(userCall![0]).toMatchObject({
      role: 'user',
      sessionId: SESSION,
      courseCode: COURSE,
      turnIndex: 0,
      content: 'hello',
    });
    expect(assistantCall![0]).toMatchObject({
      role: 'assistant',
      sessionId: SESSION,
      courseCode: COURSE,
      turnIndex: 1,
    });
    expect(assistantCall![0].content).toBe(JSON.stringify(value));
    expect(assistantCall![0].toolCalls).toEqual([
      { id: 'tc-1', toolName: 'list_materials', args: { courseCode: COURSE } },
    ]);
    expect(assistantCall![0].citations).toEqual([
      { type: 'chunk', chunkId: 'chunk-1', excerpt: 'an excerpt' },
    ]);
  });

  // -----------------------------------------------------------------------
  // 2. Simple mode passes empty tools
  // -----------------------------------------------------------------------
  it('passes empty tools array when auditMode=simple', async () => {
    mockGetSessionMessages.mockResolvedValue([]);
    mockGetCourseByCode.mockResolvedValue(makeCourse());
    mockListMaterialsByCourse.mockResolvedValue([]);
    mockCompleteWithTools.mockResolvedValue(makeResponseResult(makeAuditResponse()));

    await runAuditAgent({
      sessionId: SESSION,
      courseCode: COURSE,
      userMessage: 'hi',
      auditMode: 'simple',
    });

    expect(mockBuildAuditTools).not.toHaveBeenCalled();
    const callArgs = mockCompleteWithTools.mock.calls[0]![0] as { tools: unknown[] };
    expect(callArgs.tools).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 3. User turn persisted FIRST (before provider call)
  // -----------------------------------------------------------------------
  it('persists the user turn before invoking the provider', async () => {
    mockGetSessionMessages.mockResolvedValue([]);
    mockGetCourseByCode.mockResolvedValue(makeCourse());
    mockListMaterialsByCourse.mockResolvedValue([]);
    mockCompleteWithTools.mockResolvedValue(makeResponseResult(makeAuditResponse()));

    await runAuditAgent({
      sessionId: SESSION,
      courseCode: COURSE,
      userMessage: 'first',
      auditMode: 'full',
    });

    // The very first appendMessage call is the user turn
    expect(mockAppendMessage.mock.calls[0]![0]).toMatchObject({ role: 'user' });

    // And it ran before the provider was invoked
    const firstAppendOrder = mockAppendMessage.mock.invocationCallOrder[0]!;
    const providerOrder = mockCompleteWithTools.mock.invocationCallOrder[0]!;
    expect(firstAppendOrder).toBeLessThan(providerOrder);
  });

  // -----------------------------------------------------------------------
  // 4. Sequential turn indexes
  // -----------------------------------------------------------------------
  it('uses sequential turn indexes based on existing history length', async () => {
    // First call: empty history → user@0, assistant@1
    mockGetSessionMessages.mockResolvedValueOnce([]);
    mockGetSessionMessages.mockResolvedValueOnce([
      { role: 'user', content: 'q1', turnIndex: 0 },
    ]);
    mockGetCourseByCode.mockResolvedValue(makeCourse());
    mockListMaterialsByCourse.mockResolvedValue([]);
    mockCompleteWithTools.mockResolvedValue(makeResponseResult(makeAuditResponse()));

    await runAuditAgent({
      sessionId: SESSION,
      courseCode: COURSE,
      userMessage: 'q1',
      auditMode: 'full',
    });

    expect(mockAppendMessage.mock.calls[0]![0].turnIndex).toBe(0);
    expect(mockAppendMessage.mock.calls[1]![0].turnIndex).toBe(1);

    // Second call: 2 messages in history → user@2, assistant@3
    mockAppendMessage.mockClear();
    mockGetSessionMessages.mockResolvedValueOnce([
      { role: 'user', content: 'q1', turnIndex: 0 },
      { role: 'assistant', content: '...', turnIndex: 1 },
    ]);
    mockGetSessionMessages.mockResolvedValueOnce([
      { role: 'user', content: 'q1', turnIndex: 0 },
      { role: 'assistant', content: '...', turnIndex: 1 },
      { role: 'user', content: 'q2', turnIndex: 2 },
    ]);
    mockCompleteWithTools.mockResolvedValue(makeResponseResult(makeAuditResponse()));

    await runAuditAgent({
      sessionId: SESSION,
      courseCode: COURSE,
      userMessage: 'q2',
      auditMode: 'full',
    });

    expect(mockAppendMessage.mock.calls[0]![0].turnIndex).toBe(2);
    expect(mockAppendMessage.mock.calls[1]![0].turnIndex).toBe(3);
  });

  // -----------------------------------------------------------------------
  // 5. Course not found → throws
  // -----------------------------------------------------------------------
  it('throws when getCourseByCode returns null', async () => {
    mockGetSessionMessages.mockResolvedValue([]);
    mockGetCourseByCode.mockResolvedValue(null);
    mockListMaterialsByCourse.mockResolvedValue([]);

    await expect(
      runAuditAgent({
        sessionId: SESSION,
        courseCode: COURSE,
        userMessage: 'x',
        auditMode: 'full',
      }),
    ).rejects.toThrow(/course not found/);
  });

  // -----------------------------------------------------------------------
  // 6. Mid-loop tool_calls result → throws
  // -----------------------------------------------------------------------
  it('throws when completeWithTools returns kind=tool_calls', async () => {
    mockGetSessionMessages.mockResolvedValue([]);
    mockGetCourseByCode.mockResolvedValue(makeCourse());
    mockListMaterialsByCourse.mockResolvedValue([]);
    mockCompleteWithTools.mockResolvedValue({
      kind: 'tool_calls',
      calls: [{ id: 'tc-1', toolName: 'list_materials', args: {} }],
      telemetry: {
        costUsdCents: 0,
        durationMs: 0,
        cachedTokens: 0,
        uncachedPromptTokens: 0,
        completionTokens: 0,
      },
    });

    await expect(
      runAuditAgent({
        sessionId: SESSION,
        courseCode: COURSE,
        userMessage: 'x',
        auditMode: 'full',
      }),
    ).rejects.toThrow(/did not converge/);
  });

  // -----------------------------------------------------------------------
  // 7. At-rest context appears in messages[0]
  // -----------------------------------------------------------------------
  it('places course catalog + material digests in the first user message', async () => {
    mockGetSessionMessages.mockResolvedValueOnce([]);
    mockGetSessionMessages.mockResolvedValueOnce([
      { role: 'user', content: 'hello', turnIndex: 0 },
    ]);
    mockGetCourseByCode.mockResolvedValue(makeCourse());
    mockListMaterialsByCourse.mockResolvedValue([makeMaterial()]);
    mockCompleteWithTools.mockResolvedValue(makeResponseResult(makeAuditResponse()));

    await runAuditAgent({
      sessionId: SESSION,
      courseCode: COURSE,
      userMessage: 'hello',
      auditMode: 'full',
    });

    const callArgs = mockCompleteWithTools.mock.calls[0]![0] as { messages: Message[] };
    const first = callArgs.messages[0]!;
    expect(first.role).toBe('user');
    if (first.role !== 'user') throw new Error('unreachable');
    expect(first.content).toContain('# Course catalog');
    expect(first.content).toContain('# Material digests');
    expect(first.content).toContain('GC 4800');
    expect(first.content).toContain('syllabus.pdf');
  });
});
