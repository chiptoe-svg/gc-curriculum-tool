import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, CompleteWithToolsResult } from '@/lib/ai/tool-use-types';
import type { AuditResponse } from '@/lib/ai/agent/audit-response-schema';

// --- Mocks (declared before importing module under test) ---

const mockAppendMessage = vi.fn();
const mockGetSessionMessages = vi.fn();
const mockListPriorSessionSummaries = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []);

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
import { runAuditAgent, buildAgentCall, renderMaterialIndex } from '@/lib/ai/agent/audit-agent';

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
    // The cited chunk must have been retrieved this turn (citation check).
    mockBuildAuditTools.mockImplementationOnce(() => [
      { name: 'list_materials', description: 'desc', inputSchema: { parse: (v: unknown) => v }, execute: async () => ({ chunks: [{ id: 'chunk-1', materialId: 'mat-1' }] }) },
    ]);
    mockCompleteWithTools.mockImplementation(async (args: { tools: Array<{ execute: (a: unknown) => Promise<unknown> }> }) => {
      await args.tools[0]!.execute({ courseCode: COURSE });
      return makeResponseResult(value, [
        { id: 'tc-1', toolName: 'list_materials', args: { courseCode: COURSE } },
      ]);
    });

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
  it('places course catalog + material list in the first user message', async () => {
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
    expect(first.content).toContain('# Material list');
    expect(first.content).toContain('GC 4800');
    expect(first.content).toContain('syllabus.pdf');
  });

  // -----------------------------------------------------------------------
  // 8. Structured briefing replaces raw turn dump
  // -----------------------------------------------------------------------
  it('at-rest context uses the structured briefing, not the raw turn dump', async () => {
    mockGetCourseByCode.mockResolvedValue(makeCourse());
    mockListMaterialsByCourse.mockResolvedValue([makeMaterial()]);
    mockGetSessionMessages.mockResolvedValue([]); // opening turn (no history)
    mockListPriorSessionSummaries.mockResolvedValue([
      {
        sessionId: '4f3a1b2c-dddd-eeee-ffff-000000000000',
        startedAt: new Date('2026-05-30T00:00:00Z'),
        turnCount: 12,
        assistantTurns: [
          { finding: 'Older finding.', citations: [], readiness: { score: 40, covered: ['outcomes'], remaining: ['rubrics'] } },
          {
            finding: 'GC 3450 projects reach D=3 on layout.',
            citations: [{ type: 'chunk', chunkId: '8a1f0c11-aaaa-bbbb', excerpt: 'x' }],
            readiness: { score: 70, covered: ['outcomes', 'projects'], remaining: ['prereqs'] },
          },
        ],
        lastFacultyTurn: 'We do informal crits, no post-mortem.',
      },
    ]);

    const built = await buildAgentCall({ sessionId: 'new-session', courseCode: 'GC 4800', auditMode: 'full' });
    const first = built.messages[0]!;
    expect(first.role).toBe('user');
    if (first.role !== 'user') throw new Error('unreachable');
    const atRest = first.content as string;

    expect(atRest).toContain('Readiness: 70% · covered: outcomes, projects · remaining: prereqs');
    expect(atRest).toContain('GC 3450 projects reach D=3 on layout.');
    expect(atRest).toContain('[cites: chunk 8a1f0c11]');
    expect(atRest).toContain('Faculty last said: "We do informal crits, no post-mortem."');
    expect(atRest).not.toContain('Recent turns (chronological');
  });
});

// Material list instead of digests after the opening turn (owner, 2026-10-27).
// Digests were ~53k of GC 2070's ~70k tokens per turn and cannot be cited; the
// list halves the tokens, and at medium effort the interviewer still searched
// and cited at 3 of 3 replayed turns.
describe('material list view', () => {
  const COURSE = 'GC 4800';
  const SESSION = 'sess-1';
  const DIGEST = '## What this material is\n\nA rubric for the B6 four-color halftone project, scoring registration and dot gain. It lists five criteria.\n\n## Key terms\n\nregistration, dot gain';

  it('renders one line per material from the first sentence of its digest', () => {
    const out = renderMaterialIndex([
      { id: 'm1', fileName: 'B6 rubric.pdf', digest: DIGEST },
      { id: 'm2', fileName: 'notes.pdf', digest: null },
    ]);
    expect(out).toBe(
      '- B6 rubric.pdf (id=m1): A rubric for the B6 four-color halftone project, scoring registration and dot gain.\n'
      + '- notes.pdf (id=m2): (no summary)',
    );
  });

  it('caps a long description at 200 characters', () => {
    const long = '## What this material is\n\n' + 'x'.repeat(500);
    const line = renderMaterialIndex([{ id: 'm1', fileName: 'f.pdf', digest: long }]);
    expect(line.length).toBeLessThanOrEqual('- f.pdf (id=m1): '.length + 200);
  });

  it("buildAgentCall with materialsView 'index' sends the list, not the digests", async () => {
    mockGetSessionMessages.mockResolvedValue([]);
    mockGetCourseByCode.mockResolvedValue(makeCourse());
    mockListMaterialsByCourse.mockResolvedValue([makeMaterial({ digest: DIGEST })]);

    const built = await buildAgentCall({ sessionId: SESSION, courseCode: COURSE, userMessage: 'hi', auditMode: 'full', materialsView: 'index' });
    const first = built.messages[0]!;
    if (first.role !== 'user') throw new Error('unreachable');
    expect(first.content).toContain('# Material list');
    expect(first.content).not.toContain('# Material digests');
    expect(first.content).not.toContain('Key terms');
  });

  async function firstMessage(input: { userMessage?: string; auditMode: 'full' | 'simple'; materialsView?: 'digests' | 'index' }) {
    mockGetSessionMessages.mockResolvedValue([]);
    mockGetCourseByCode.mockResolvedValue(makeCourse());
    mockListMaterialsByCourse.mockResolvedValue([makeMaterial({ digest: DIGEST })]);
    const built = await buildAgentCall({ sessionId: SESSION, courseCode: COURSE, ...input });
    const first = built.messages[0]!;
    if (first.role !== 'user') throw new Error('unreachable');
    return first.content as string;
  }

  it('sends the list on a continuing full-mode turn by default', async () => {
    const content = await firstMessage({ userMessage: 'hi', auditMode: 'full' });
    expect(content).toContain('# Material list');
    expect(content).not.toContain('Key terms');
  });

  it('sends the digests on the opening turn', async () => {
    const content = await firstMessage({ auditMode: 'full' });
    expect(content).toContain('# Material digests');
    expect(content).toContain('Key terms');
  });

  it('sends the digests in simple mode (no tools to read a material)', async () => {
    const content = await firstMessage({ userMessage: 'hi', auditMode: 'simple' });
    expect(content).toContain('# Material digests');
  });

  it('an explicit materialsView overrides the default', async () => {
    const content = await firstMessage({ userMessage: 'hi', auditMode: 'full', materialsView: 'digests' });
    expect(content).toContain('# Material digests');
  });
});


// Live interview checks (owner, 2026-10-28; from the harness spike): force a
// search when the exchange points at course files, and keep only citations
// the interviewer could have seen.
describe('interview checks', () => {
  const COURSE = 'GC 4800';
  const SESSION = 'sess-1';
  const prevAssistant = { id: 'a1', role: 'assistant', content: JSON.stringify({ question: 'What do students choose on their own?' }), turnIndex: 1 };
  const userRow = (content: string) => ({ id: 'u2', role: 'user', content, turnIndex: 2 });

  function setup(userMessage: string, mode: 'full' | 'simple' = 'full') {
    mockGetSessionMessages.mockResolvedValueOnce([{ id: 'u0', role: 'user', content: 'hi', turnIndex: 0 }, prevAssistant]);
    mockGetSessionMessages.mockResolvedValueOnce([{ id: 'u0', role: 'user', content: 'hi', turnIndex: 0 }, prevAssistant, userRow(userMessage)]);
    mockGetCourseByCode.mockResolvedValue(makeCourse());
    mockListMaterialsByCourse.mockResolvedValue([makeMaterial()]);
    return { sessionId: SESSION, courseCode: COURSE, userMessage, auditMode: mode };
  }

  it('requires a material search first when the answer is about a rubric', async () => {
    const input = setup('It is graded on the rubric.');
    mockCompleteWithTools.mockResolvedValue(makeResponseResult(makeAuditResponse({ citations: [] })));
    await runAuditAgent(input);
    const args = mockCompleteWithTools.mock.calls[0]![0] as { requireToolFirst?: string[] };
    expect(args.requireToolFirst).toEqual(['search_materials', 'fetch_material_section']);
  });

  it('does not force a search on generic practice talk', async () => {
    const input = setup('They usually pick bright images and talk it through with me.');
    mockCompleteWithTools.mockResolvedValue(makeResponseResult(makeAuditResponse({ citations: [] })));
    await runAuditAgent(input);
    const args = mockCompleteWithTools.mock.calls[0]![0] as { requireToolFirst?: string[] };
    expect(args.requireToolFirst).toBeUndefined();
  });

  it('never forces a search in simple mode (no tools)', async () => {
    const input = setup('It is graded on the rubric.', 'simple');
    mockCompleteWithTools.mockResolvedValue(makeResponseResult(makeAuditResponse({ citations: [] })));
    await runAuditAgent(input);
    const args = mockCompleteWithTools.mock.calls[0]![0] as { requireToolFirst?: string[] };
    expect(args.requireToolFirst).toBeUndefined();
  });

  it('keeps citations of passages retrieved this turn and real instructor messages, drops the rest', async () => {
    const input = setup('It is graded on the rubric.');
    mockCompleteWithTools.mockImplementation(async (args: { tools: Array<{ name: string; execute: (a: unknown) => Promise<unknown> }> }) => {
      await args.tools.find(t => t.name === 'search_materials')!.execute({ courseCode: COURSE, query: 'rubric' });
      return makeResponseResult(makeAuditResponse({
        citations: [
          { type: 'chunk', chunkId: 'chunk-1', excerpt: 'retrieved' },
          { type: 'chunk', chunkId: 'ghost', excerpt: 'never retrieved' },
          { type: 'instructor', messageId: 'u2', excerpt: 'real' },
          { type: 'instructor', messageId: 'user_3', excerpt: 'invented' },
        ],
      }));
    });
    mockBuildAuditTools.mockImplementationOnce(() => [
      { name: 'search_materials', description: 'desc', inputSchema: { parse: (v: unknown) => v }, execute: async () => ({ chunks: [{ id: 'chunk-1', materialId: 'mat-1', text: 'x' }] }) },
    ]);
    const result = await runAuditAgent(input);
    expect(result.response.citations.map(c => c.chunkId ?? c.messageId)).toEqual(['chunk-1', 'u2']);
    const assistantCall = mockAppendMessage.mock.calls.find(c => (c[0] as { role: string }).role === 'assistant')!;
    expect((assistantCall[0] as { citations: Array<{ chunkId?: string; messageId?: string }> }).citations.map(c => c.chunkId ?? c.messageId)).toEqual(['chunk-1', 'u2']);
    expect(JSON.parse((assistantCall[0] as { content: string }).content).citations).toHaveLength(2);
  });

  it('keeps a chunk cited in an earlier turn', async () => {
    mockGetSessionMessages.mockResolvedValueOnce([{ id: 'u0', role: 'user', content: 'hi', turnIndex: 0 }, { ...prevAssistant, content: JSON.stringify({ question: 'q?', citations: [{ type: 'chunk', chunkId: 'old' }] }) }]);
    mockGetSessionMessages.mockResolvedValueOnce([{ id: 'u0', role: 'user', content: 'hi', turnIndex: 0 }, { ...prevAssistant, content: JSON.stringify({ question: 'q?', citations: [{ type: 'chunk', chunkId: 'old' }] }) }, userRow('ok')]);
    mockGetCourseByCode.mockResolvedValue(makeCourse());
    mockListMaterialsByCourse.mockResolvedValue([makeMaterial()]);
    mockCompleteWithTools.mockResolvedValue(makeResponseResult(makeAuditResponse({ citations: [{ type: 'chunk', chunkId: 'old', excerpt: 'again' }] })));
    const result = await runAuditAgent({ sessionId: SESSION, courseCode: COURSE, userMessage: 'ok', auditMode: 'full' });
    expect(result.response.citations).toHaveLength(1);
  });
});

describe('forced search fallback', () => {
  it('retries once without forcing when the forced request is rejected', async () => {
    mockGetSessionMessages.mockResolvedValueOnce([]);
    mockGetSessionMessages.mockResolvedValueOnce([{ id: 'u0', role: 'user', content: 'It is graded on the rubric.', turnIndex: 0 }]);
    mockGetCourseByCode.mockResolvedValue(makeCourse());
    mockListMaterialsByCourse.mockResolvedValue([makeMaterial()]);
    mockCompleteWithTools
      .mockRejectedValueOnce(new Error('400 tool_choice not supported'))
      .mockResolvedValueOnce(makeResponseResult(makeAuditResponse({ citations: [] })));
    const result = await runAuditAgent({ sessionId: 'sess-1', courseCode: 'GC 4800', userMessage: 'It is graded on the rubric.', auditMode: 'full' });
    expect(result.response.finding).toBe('Some finding text.');
    expect(mockCompleteWithTools).toHaveBeenCalledTimes(2);
    expect((mockCompleteWithTools.mock.calls[0]![0] as { requireToolFirst?: string[] }).requireToolFirst).toBeDefined();
    expect((mockCompleteWithTools.mock.calls[1]![0] as { requireToolFirst?: string[] }).requireToolFirst).toBeUndefined();
  });
});
