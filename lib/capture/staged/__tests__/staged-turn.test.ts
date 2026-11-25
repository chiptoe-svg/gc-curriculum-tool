/** Task 6: the staged interview turn (context, tools, skip/finish, ledger rebuild, adapter). runPiTurn and the DB are mocked. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EvidenceMap } from '../evidence-map';

type Row = {
  id: string; courseCode: string; sessionId: string; turnIndex: number; role: string; content: string | null;
  toolCalls: Array<{ id: string; toolName: string; args: Record<string, unknown> }> | null; createdAt: Date;
};
const db = vi.hoisted(() => ({ rows: [] as Row[], clock: 1_000_000, materials: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/db/capture-messages-queries', () => ({
  appendMessage: vi.fn(async (i: { courseCode: string; sessionId: string; turnIndex: number; role: string; content?: string | null; toolCalls?: Row['toolCalls'] }) => {
    if (db.rows.some(r => r.sessionId === i.sessionId && r.turnIndex === i.turnIndex)) throw new Error(`duplicate turn ${i.turnIndex}`);
    db.rows.push({
      id: `m${db.rows.length + 1}`, courseCode: i.courseCode, sessionId: i.sessionId, turnIndex: i.turnIndex, role: i.role,
      content: i.content ?? null, toolCalls: i.toolCalls ?? null, createdAt: new Date(db.clock++),
    });
  }),
  getSessionMessages: vi.fn(async (_c: string, s: string) => db.rows.filter(r => r.sessionId === s).sort((a, b) => a.turnIndex - b.turnIndex).map(r => ({ ...r }))),
  listPriorSessionSummaries: vi.fn(async () => []),
}));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: vi.fn(async () => db.materials) }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn(async (code: string) => ({
    code, title: 'Flexography', description: 'Flexo printing.', prerequisites: null, learningObjectives: [], majorProjects: [], skillsRequired: [],
  })),
}));
vi.mock('@/lib/ai/agent/audit-tools', () => ({
  buildAuditTools: () => [
    { name: 'search_materials', description: 'search', inputSchema: { parse: (v: unknown) => v }, execute: async () => [{ id: 'chunk-searched', materialId: 'mat1', text: 'x' }] },
    { name: 'fetch_material_section', description: 'fetch', inputSchema: { parse: (v: unknown) => v }, execute: async () => ({ chunks: [] }) },
    { name: 'search_wiki', description: 'wiki', inputSchema: { parse: (v: unknown) => v }, execute: async () => ({}) },
  ],
}));
const runPiTurn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/agent/pi/turn', () => ({ runPiTurn }));
vi.mock('@/lib/ai/agent/pi/endpoint', () => ({ piEndpointFor: async () => ({ baseUrl: 'http://x', apiKey: 'k', model: 'cub', api: 'openai-completions' }) }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ recordSpend: vi.fn(async () => {}) }));

import { runStagedTurn, streamStagedInterview, ledgerEventsFromTranscript, leadNotesFromTranscript } from '../staged-turn';
import { buildLedger, type LedgerEvent } from '../ledger';
import { exhaust } from './helpers';
import type { InterviewSessionRow } from '@/lib/db/capture-interview-sessions-queries';

const SID = '11111111-1111-1111-1111-111111111111';
const MAP: EvidenceMap = {
  summary: 'A flexo course.',
  graded_work: [{ title: 'Plate Project', weight: '25%', deliverables: 'a plate', rubric_criteria: ['registration'], source: 'chunk-map-1' }],
  tests: [], competencies: [], assumed_skills: [{ skill: 'Illustrator', used_in: 'Plate Project', source: 'chunk-map-2' }],
  objectives: [{ text: 'o', status: 'graded_work_found', graded_work: ['Plate Project'] }], conflicts: [], unreadable: [],
};
const session: InterviewSessionRow = {
  sessionId: SID, courseCode: 'GC 4060', map: MAP, mapStatus: 'ready', materialsFingerprint: null, mapEditedAt: null, mapStartedAt: null, createdAt: new Date(0),
};

type Step = {
  calls?: Array<[string, Record<string, unknown>]>;
  submit: { say?: string; question?: string; citations?: unknown[]; slot_asked: string; kind: string };
};
const steps: Step[] = [];
type PiInput = {
  systemPrompt: string; messages: Array<{ role: string; content: string }>; requireSearchFirst?: boolean; maxToolCalls?: number;
  tools: Array<{ name: string; inputSchema: { parse: (v: unknown) => unknown }; execute: (a: unknown) => Promise<unknown> }>;
  submit: { parse: (v: unknown) => unknown }; checkSubmit?: (v: unknown) => string | null;
};
const calls: PiInput[] = [];
const toolResults: unknown[] = [];

beforeEach(() => {
  db.rows.length = 0; db.materials = []; steps.length = 0; calls.length = 0; toolResults.length = 0;
  delete process.env.INTERVIEW_BLOOM;
  runPiTurn.mockReset();
  runPiTurn.mockImplementation(async (input: PiInput) => {
    calls.push(input);
    const step = steps.shift();
    if (!step) throw new Error('no scripted step');
    const toolCallsUsed: Array<{ id: string; toolName: string; args: Record<string, unknown> }> = [];
    for (const [name, raw] of step.calls ?? []) {
      const t = input.tools.find(x => x.name === name);
      if (!t) throw new Error(`tool ${name} not offered`);
      const args = t.inputSchema.parse(raw) as Record<string, unknown>;
      toolCallsUsed.push({ id: `tc${toolCallsUsed.length}`, toolName: name, args });
      toolResults.push(await t.execute(args));
    }
    const value = input.submit.parse({ say: 'ok', question: '', citations: [], ...step.submit });
    const problem = input.checkSubmit?.(value) ?? null;
    return { value, toolCallsUsed, telemetry: { costUsdCents: 0 }, controlEvents: problem ? ['repeat-accepted'] : [], requests: 1 };
  });
});

const turn = (userMessage?: string, extra: Record<string, unknown> = {}) =>
  runStagedTurn({ sessionId: SID, courseCode: 'GC 4060', auditMode: 'full', ...(userMessage ? { userMessage } : {}), ...extra }, session);
const rec = (slot: string, summary: string, status = 'filled_by_instructor') =>
  ['record_answer', { slot, status, summary, citations: [] }] as [string, Record<string, unknown>];
const context = (i = calls.length - 1) => calls[i]!.messages[0]!.content;
const storedLedger = () => buildLedger(MAP, ledgerEventsFromTranscript(db.rows));
const assistantRows = () => db.rows.filter(r => r.role === 'assistant');
const lastStaged = () => JSON.parse(assistantRows().at(-1)!.content!).staged;

describe('runStagedTurn', () => {
  it('opening turn asks stage 1 with the stage-1 skill in the system prompt', async () => {
    steps.push({ submit: { question: 'What can students do when they leave?', slot_asked: 'outcomes', kind: 'question' } });
    const { response } = await turn();
    const sys = calls[0]!.systemPrompt;
    expect(sys).toContain('# Role');
    expect(sys).toContain('# Stage 1: The course in your words');
    expect(sys).not.toContain('# Stage 2');
    expect(context()).toContain('Open in this stage: outcomes, anchors');
    expect(context()).toContain('Questions asked: 0 of 20');
    expect(context()).toContain('Plate Project');
    expect(calls[0]!.requireSearchFirst).toBe(false);
    expect(calls[0]!.maxToolCalls).toBe(6);
    expect(calls[0]!.tools.map(t => t.name).sort()).toEqual(['fetch_material_section', 'load_skill', 'note_for_lead', 'record_answer', 'search_materials']);
    expect(response.question).toBe('What can students do when they leave?');
    expect(response.staged).toMatchObject({ stage: 1, stageTitle: 'The course in your words', questionsAsked: 1, cap: 20, slotAsked: 'outcomes', kind: 'question' });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ role: 'assistant', turnIndex: 0 });
  });

  it('record_answer in turn N fills the slot; turn N+1 context lists it under Answered so far', async () => {
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question' } });
    await turn();
    steps.push({ calls: [rec('outcomes', 'Students can mount and proof a plate.')], submit: { slot_asked: 'anchors', kind: 'question' } });
    await turn('They mount and proof plates.');
    steps.push({ submit: { slot_asked: 'anchors', kind: 'answer_only' } });
    await turn('What do you mean?');
    expect(context(2)).toMatch(/Answered so far:\n- outcomes \(filled_by_instructor\): Students can mount and proof a plate\./);
    expect(context(2)).toContain('Open in this stage: anchors');
    expect(storedLedger().slots.outcomes?.status).toBe('filled_by_instructor');
  });

  it('resume rebuilds ledger: the ledger from stored rows deep-equals the live one across 3 turns, and the stage continues', async () => {
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question' } });
    const t1 = await turn();
    expect(storedLedger()).toEqual(t1.ledger);
    steps.push({ calls: [rec('outcomes', 'Mount plates.')], submit: { slot_asked: 'anchors', kind: 'question' } });
    const t2 = await turn('Mount plates.');
    expect(storedLedger()).toEqual(t2.ledger);
    steps.push({ calls: [rec('anchors', '- Plate Project\n- Press Run Report')], submit: { slot_asked: 'graded_on:Plate Project', kind: 'question' } });
    const t3 = await turn('Plate Project and the Press Run Report.');
    expect(storedLedger()).toEqual(t3.ledger);
    expect(t3.ledger.anchors).toEqual(['Plate Project', 'Press Run Report']);
    expect(t3.response.staged?.stage).toBe(2);
    // A reload: the next turn rebuilds from rows only and stays in stage 2.
    steps.push({ submit: { slot_asked: 'conditions', kind: 'question' } });
    await turn('They are graded on registration.');
    expect(calls[3]!.systemPrompt).toContain('# Stage 2: Evidence walk');
    expect(context(3)).toContain('Open in this stage: graded_on:Plate Project, graded_on:Press Run Report, conditions, reasoning_evidence, tests');
    expect(context(3)).toContain('Questions asked: 3 of 20');
  });

  it('skip marks unknown (very first question)', async () => {
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question' } });
    await turn();
    steps.push({ submit: { slot_asked: 'anchors', kind: 'question' } });
    await turn('Skip');
    expect(context(1)).toContain('- outcomes (unknown): instructor skipped');
    expect(context(1)).toContain('Open in this stage: anchors');
    expect(storedLedger().slots.outcomes?.status).toBe('unknown');
    steps.push({ submit: { slot_asked: 'graded_on:x', kind: 'answer_only' } });
    await turn('skip this question.');
    expect(storedLedger().slots.anchors?.status).toBe('unknown');
  });

  it('finish → mustRecap and the stage-6 skill; the request is stored on the row and the rebuilt ledger sees it', async () => {
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question' } });
    await turn();
    steps.push({ submit: { question: 'Here is what I heard…', slot_asked: 'recap', kind: 'recap' } });
    const t = await turn('I have to go.', { finish: true });
    expect(calls[1]!.systemPrompt).toContain('# Stage 6: Objectives and close');
    expect(calls[1]!.systemPrompt).not.toContain('# Stage 1');
    expect(context(1)).toMatch(/recap/);
    expect(lastStaged()).toMatchObject({ kind: 'recap', slotAsked: 'recap', finishRequested: true });
    expect(storedLedger().finished).toBe(true);
    expect(storedLedger()).toEqual(t.ledger);
    expect(t.response.readiness.good_enough_to_generate).toBe(true);
    expect(storedLedger().slots.outcomes?.status).toBe('not_reached');
  });

  it('finish with no message stores no user row and still runs the recap', async () => {
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question' } });
    await turn();
    steps.push({ submit: { slot_asked: 'recap', kind: 'recap' } });
    await turn(undefined, { finish: true });
    expect(db.rows.map(r => [r.role, r.turnIndex])).toEqual([['assistant', 0], ['assistant', 1]]);
    expect(calls[1]!.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(lastStaged()).toMatchObject({ kind: 'recap', finishRequested: true });
  });

  it('a second finish is not stored twice', async () => {
    steps.push({ submit: { slot_asked: 'recap', kind: 'recap' } });
    await turn(undefined, { finish: true });
    steps.push({ submit: { slot_asked: 'recap', kind: 'answer_only' } });
    await turn('ok', { finish: true });
    expect(ledgerEventsFromTranscript(db.rows).filter(e => e.type === 'finish')).toHaveLength(1);
  });

  it('material added in this session after the last turn → requireSearchFirst true; a keyword alone → false', async () => {
    db.materials = [{ id: 'mat-flexo', fileName: 'Flexo plate brief.pdf', digest: 'Plate brief.', extractionStatus: 'ok', ignored: false, autoSetAside: false, retiredAt: null, addedInSession: null, uploadedAt: new Date(0) }];
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question' } });
    await turn();
    steps.push({ submit: { slot_asked: 'anchors', kind: 'question' } });
    await turn('The flexo rubric covers it.');
    expect(calls[1]!.requireSearchFirst).toBe(false);
    db.materials.push({ id: 'mat-new', fileName: 'Rubric.pdf', digest: 'Rubric.', extractionStatus: 'ok', ignored: false, autoSetAside: false, retiredAt: null, addedInSession: SID, uploadedAt: new Date(db.clock++) });
    steps.push({ submit: { slot_asked: 'anchors', kind: 'answer_only' } });
    await turn('I added the rubric.');
    expect(calls[2]!.requireSearchFirst).toBe(true);
    // Once a turn has answered after it, the same file no longer forces a search.
    steps.push({ submit: { slot_asked: 'anchors', kind: 'answer_only' } });
    await turn('Anything else?');
    expect(calls[3]!.requireSearchFirst).toBe(false);
  });

  it('note_for_lead is stored and not counted as a question', async () => {
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question' } });
    await turn();
    steps.push({ calls: [['note_for_lead', { note: 'Wants a shared press lab schedule.' }]], submit: { slot_asked: 'outcomes', kind: 'answer_only' } });
    const t = await turn('Also, the press lab schedule is a mess.');
    expect(toolResults.at(-1)).toBe('noted');
    expect(assistantRows().at(-1)!.toolCalls).toEqual([expect.objectContaining({ toolName: 'note_for_lead', args: { note: 'Wants a shared press lab schedule.' } })]);
    expect(t.response.staged?.questionsAsked).toBe(1);
    expect(leadNotesFromTranscript(db.rows)).toEqual(['Wants a shared press lab schedule.']);
  });

  it('record_answer rejects an unknown slot and not_reached, and a rejected call is not stored', async () => {
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question' } });
    await turn();
    steps.push({ calls: [rec('graded_on:Nothing', 'x'), rec('outcomes', 'x', 'not_reached'), rec('objectives', 'x'), rec('outcomes', 'Mount plates.')], submit: { slot_asked: 'anchors', kind: 'question' } });
    await turn('Mount plates.');
    expect(toolResults.slice(-4, -1).every(r => typeof r === 'string' && /^error/.test(r))).toBe(true);
    expect(toolResults.at(-1)).toBe('recorded');
    expect(assistantRows().at(-1)!.toolCalls!.map(c => c.args.slot)).toEqual(['outcomes']);
  });

  it('load_skill returns a situational skill body and refuses anything else', async () => {
    steps.push({ calls: [['load_skill', { name: 'materials-vs-testimony' }], ['load_skill', { name: 'stage-2-evidence' }]], submit: { slot_asked: 'outcomes', kind: 'question' } });
    await turn();
    expect(String(toolResults[0])).not.toMatch(/^error/);
    expect(String(toolResults[0]).length).toBeGreaterThan(50);
    expect(String(toolResults[1])).toMatch(/^error/);
  });

  it('a turn that still breaks the stage rules after send-backs is stored as answer_only and not counted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    steps.push({ submit: { slot_asked: 'habits', kind: 'question' } });
    const t = await turn();
    expect(lastStaged()).toMatchObject({ kind: 'answer_only', slotAsked: 'habits' });
    expect(t.response.staged?.questionsAsked).toBe(0);
    warn.mockRestore();
  });

  it('checkSubmit sends back a turn aimed at another stage', async () => {
    steps.push({ submit: { slot_asked: 'habits', kind: 'question' } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await turn();
    const v = calls[0]!.submit.parse({ say: '', question: 'q', citations: [], slot_asked: 'habits', kind: 'question' });
    expect(calls[0]!.checkSubmit!(v)).toMatch(/stage 1/);
    const ok = calls[0]!.submit.parse({ say: '', question: 'q', citations: [], slot_asked: 'outcomes', kind: 'question' });
    expect(calls[0]!.checkSubmit!(ok)).toBeNull();
  });

  it('citations: evidence-map chunks and searched chunks are kept, invented ones dropped', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    steps.push({
      calls: [['search_materials', { query: 'plate' }]],
      submit: {
        slot_asked: 'outcomes', kind: 'question',
        citations: [
          { type: 'chunk', chunkId: 'chunk-map-1', messageId: null, excerpt: 'from the map' },
          { type: 'chunk', chunkId: 'chunk-searched', messageId: null, excerpt: 'searched' },
          { type: 'chunk', chunkId: 'chunk-invented', messageId: null, excerpt: 'invented' },
        ],
      },
    });
    const t = await turn();
    expect(t.response.citations.map(c => c.chunkId)).toEqual(['chunk-map-1', 'chunk-searched']);
  });

  it('the recap answer is recorded by the app when the model did not record it', async () => {
    steps.push({ submit: { slot_asked: 'recap', kind: 'recap' } });
    await turn(undefined, { finish: true });
    steps.push({ submit: { say: 'Thank you.', slot_asked: 'recap', kind: 'answer_only' } });
    const t = await turn('Yes, that is right, but add the press check.');
    expect(t.ledger.slots.recap).toMatchObject({ status: 'filled_by_instructor', summary: 'Yes, that is right, but add the press check.' });
    expect(storedLedger()).toEqual(t.ledger);
    expect(t.state.done).toBe(true);
  });

  it('the recap as question 20: the final answer is still stored and recap recorded', async () => {
    // Seed 19 counted questions, then the recap as the 20th.
    const seeded: LedgerEvent[] = [...exhaust(MAP, 19)];
    const recapAsked = exhaust(MAP, 20).at(-1)!;
    seeded.push(recapAsked);
    let i = 0;
    for (const ev of seeded) {
      if (ev.type !== 'asked') continue;
      db.rows.push({
        id: `seed${i}`, courseCode: 'GC 4060', sessionId: SID, turnIndex: i++, role: 'assistant', toolCalls: null, createdAt: new Date(db.clock++),
        content: JSON.stringify({ finding: 'f', question: 'q', citations: [], readiness: { score: 0, covered: [], remaining: [], good_enough_to_generate: false }, staged: { stage: ev.turn.stage, stageTitle: 't', stageProgress: [], questionsAsked: 0, cap: 20, slotAsked: ev.turn.slot, kind: ev.turn.kind } }),
      });
    }
    expect(recapAsked).toMatchObject({ turn: { kind: 'recap' } });
    steps.push({ submit: { say: 'Thanks.', slot_asked: 'recap', kind: 'answer_only' } });
    const t = await turn('Looks right.');
    expect(db.rows.at(-2)).toMatchObject({ role: 'user', content: 'Looks right.' });
    expect(t.ledger.slots.recap).toMatchObject({ status: 'filled_by_instructor', summary: 'Looks right.' });
    expect(storedLedger().slots.recap?.status).toBe('filled_by_instructor');
  });

  it('INTERVIEW_BLOOM=off strips the Bloom blocks from the stage skill', async () => {
    // The stage-6 skill (used for the recap) has Bloom blocks.
    steps.push({ submit: { slot_asked: 'recap', kind: 'recap' } }, { submit: { slot_asked: 'recap', kind: 'recap' } });
    await turn(undefined, { finish: true });
    const withBloom = calls[0]!.systemPrompt;
    db.rows.length = 0;
    process.env.INTERVIEW_BLOOM = 'off';
    await turn(undefined, { finish: true });
    expect(calls[1]!.systemPrompt).toContain('# Stage 6');
    expect(calls[1]!.systemPrompt.length).toBeLessThan(withBloom.length);
  });
});

/** Seed stored assistant rows for the given asked turns (no tool calls). */
function seedAsked(events: LedgerEvent[]) {
  for (const ev of events) {
    if (ev.type !== 'asked') continue;
    const i = db.rows.length;
    db.rows.push({
      id: `seed${i}`, courseCode: 'GC 4060', sessionId: SID, turnIndex: i, role: 'assistant', toolCalls: null, createdAt: new Date(db.clock++),
      content: JSON.stringify({ finding: 'f', question: 'q', citations: [], readiness: { score: 0, covered: [], remaining: [], good_enough_to_generate: false }, staged: { stage: ev.turn.stage, stageTitle: 't', stageProgress: [], questionsAsked: 0, cap: 20, slotAsked: ev.turn.slot, kind: ev.turn.kind } }),
    });
  }
}

describe('endpoint override (Task 9 benchmark)', () => {
  it('uses the live capture-chat-agent endpoint by default', async () => {
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question', question: 'q?' } });
    await turn();
    expect((calls[0] as unknown as { endpoint: { model: string } }).endpoint.model).toBe('cub');
  });

  it('an explicit endpoint on the input replaces the live setting', async () => {
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question', question: 'q?' } });
    const ep = { baseUrl: 'http://campus', apiKey: 'k2', model: 'qwen3.8-27b-fp8', api: 'openai-completions' };
    await turn(undefined, { endpoint: ep });
    expect((calls[0] as unknown as { endpoint: unknown }).endpoint).toEqual(ep);
  });
});

describe('fix round 1', () => {
  it("refuses a session row from another course and stores nothing", async () => {
    const other = { ...session, courseCode: 'GC 9999' };
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question' } });
    await expect(runStagedTurn({ sessionId: SID, courseCode: 'GC 4060', auditMode: 'full', userMessage: 'hi' }, other)).rejects.toThrow('session does not belong to this course');
    const ev: Array<{ kind: string; message?: string }> = [];
    for await (const e of streamStagedInterview({ sessionId: SID, courseCode: 'GC 4060', auditMode: 'full', userMessage: 'hi' }, other)) ev.push(e);
    expect(ev).toEqual([{ kind: 'error', message: 'session does not belong to this course' }]);
    expect(db.rows).toHaveLength(0);
    expect(runPiTurn).not.toHaveBeenCalled();
  });

  it('repeat-accepted at the cap: the question is emptied and not counted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedAsked(exhaust(MAP, 20));
    steps.push({ submit: { question: 'One more thing: how do they revise?', slot_asked: 'revision', kind: 'question' } });
    const t = await turn('Done?');
    expect(t.response.question).toBe('');
    expect(t.response.staged).toMatchObject({ kind: 'answer_only', questionsAsked: 20 });
    expect(JSON.parse(assistantRows().at(-1)!.content!).question).toBe('');
  });

  it("the model's answer_only with a question is sent back while the interview runs", async () => {
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question' } });
    await turn();
    const v = calls[0]!.submit.parse({ say: 's', question: 'And how do they revise?', citations: [], slot_asked: 'outcomes', kind: 'answer_only' });
    expect(calls[0]!.checkSubmit!(v)).toBe('answer_only turns carry no question; put the question in a counted turn');
    const plain = calls[0]!.submit.parse({ say: 's', question: '', citations: [], slot_asked: 'outcomes', kind: 'answer_only' });
    expect(calls[0]!.checkSubmit!(plain)).toBeNull();
  });

  it('after done, answer_only is accepted with the question emptied', async () => {
    seedAsked(exhaust(MAP, 20));
    steps.push({ submit: { say: 'Thanks!', question: 'Anything else?', slot_asked: 'recap', kind: 'answer_only' } });
    const t = await turn('Bye.');
    expect(calls[0]!.checkSubmit!(calls[0]!.submit.parse({ say: 's', question: 'Anything else?', citations: [], slot_asked: 'recap', kind: 'answer_only' }))).toBeNull();
    expect(t.response.finding).toBe('Thanks!');
    expect(t.response.question).toBe('');
    expect(JSON.parse(assistantRows().at(-1)!.content!).question).toBe('');
  });

  it('record_answer citations are filtered with the same allowed set; the record is kept', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    steps.push({ submit: { slot_asked: 'outcomes', kind: 'question' } });
    await turn();
    steps.push({
      calls: [['record_answer', {
        slot: 'outcomes', status: 'filled_by_instructor', summary: 'Mount plates.',
        citations: [
          { type: 'chunk', chunkId: 'chunk-map-1', messageId: null, excerpt: 'map' },
          { type: 'chunk', chunkId: 'chunk-invented', messageId: null, excerpt: 'invented' },
          { type: 'instructor', chunkId: null, messageId: 'm2', excerpt: 'They mount plates' },
          { type: 'instructor', chunkId: null, messageId: 'user_3', excerpt: 'nothing like this was said' },
        ],
      }]],
      submit: { slot_asked: 'anchors', kind: 'question' },
    });
    const t = await turn('They mount plates every week.');
    const want = [
      { type: 'chunk', chunkId: 'chunk-map-1', messageId: null, excerpt: 'map' },
      { type: 'instructor', chunkId: null, messageId: 'm2', excerpt: 'They mount plates' },
    ];
    expect(assistantRows().at(-1)!.toolCalls![0]!.args.citations).toEqual(want);
    expect(t.ledger.slots.outcomes?.citations).toEqual(want);
    expect(storedLedger()).toEqual(t.ledger);
  });
});

describe('streamStagedInterview', () => {
  it('emits tool-start per tool call then final, and persists the turn', async () => {
    steps.push({ calls: [['search_materials', { query: 'plate' }]], submit: { slot_asked: 'outcomes', kind: 'question' } });
    runPiTurn.mockImplementationOnce(async (input: PiInput & { onEvent?: (e: unknown) => void }) => {
      input.onEvent?.({ kind: 'tool-start', toolName: 'search_materials', args: { query: 'plate' } });
      const value = input.submit.parse({ say: 's', question: 'q', citations: [], slot_asked: 'outcomes', kind: 'question' });
      return { value, toolCallsUsed: [], telemetry: { costUsdCents: 0 }, controlEvents: [], requests: 1 };
    });
    const kinds: string[] = [];
    for await (const e of streamStagedInterview({ sessionId: SID, courseCode: 'GC 4060', auditMode: 'full' }, session)) kinds.push(e.kind);
    expect(kinds).toEqual(['tool-start', 'final']);
    expect(assistantRows()).toHaveLength(1);
  });

  it('a Pi failure yields an error event and stores no assistant row', async () => {
    runPiTurn.mockRejectedValueOnce(new Error('boom'));
    const ev: Array<{ kind: string }> = [];
    for await (const e of streamStagedInterview({ sessionId: SID, courseCode: 'GC 4060', auditMode: 'full', userMessage: 'hi' }, session)) ev.push(e);
    expect(ev.map(e => e.kind)).toEqual(['error']);
    expect(assistantRows()).toHaveLength(0);
  });
});
