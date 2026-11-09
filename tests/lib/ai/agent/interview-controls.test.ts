/** Interview checks (search trigger, citation check): pure functions, no model calls. */
import { describe, it, expect } from 'vitest';
import { checkCitations, chunkIdsInToolResult, citableFromHistory, needsMaterialSearch, previousQuestion } from '@/lib/ai/agent/interview-controls';

describe('needsMaterialSearch', () => {
  it('fires on the previous question when the answer alone names nothing (2070-104)', () => {
    const q = 'After printing the NANO colors in sequence, what explanation do students give in their lab reports that shows they now understand halftone dots?';
    expect(needsMaterialSearch('Most student comment on the need for proper registration.', [], q).required).toBe(true);
  });
  it('fires on an assignment code (2070-088)', () => {
    const q = 'At the start of A2–A3, can students already place, scale, and edit artwork in Illustrator?';
    expect(needsMaterialSearch('yes student can place, scale, and edit artwork effortlessly', [], q)).toMatchObject({ required: true });
  });
  it('fires on grading words in a short answer (1020-016)', () => {
    expect(needsMaterialSearch('Based on final submission only', []).required).toBe(true);
  });
  it('does not fire on generic practice talk', () => {
    expect(needsMaterialSearch('They usually pick bright images and talk it through with me.', ['Syllabus.pdf'], 'What do students choose on their own?').required).toBe(false);
  });
  it('fires when the exchange names a distinctive course file word', () => {
    expect(needsMaterialSearch('We use the screenprinting setup for that.', ['Screenprinting Setup Guide.pdf']).required).toBe(true);
  });
  it('never fires on the opening turn', () => {
    expect(needsMaterialSearch(undefined, ['Rubric.pdf'], 'rubric?').required).toBe(false);
  });
});

describe('chunkIdsInToolResult', () => {
  it('collects search hits by id (SearchHit carries the chunk id as `id`) and explicit chunkIds', () => {
    const ids = new Set<string>();
    chunkIdsInToolResult({ chunks: [{ id: 'c1', materialId: 'm1', text: 'x' }, { chunkId: 'c2' }], other: { id: 'not-a-chunk' } }, ids);
    expect([...ids].sort()).toEqual(['c1', 'c2']);
  });
});

describe('checkCitations', () => {
  const history = citableFromHistory([
    { role: 'user', content: '[messageId=u1]\nanswer' },
    { role: 'assistant', content: JSON.stringify({ question: 'q?', citations: [{ type: 'chunk', chunkId: 'old' }] }) },
  ]);
  it('accepts passages retrieved this turn or cited earlier, and real instructor messages', () => {
    const r = { citations: [{ type: 'chunk' as const, chunkId: 'new', excerpt: '' }, { type: 'chunk' as const, chunkId: 'old', excerpt: '' }, { type: 'instructor' as const, messageId: 'u1', excerpt: '' }] };
    expect(checkCitations(r, { retrievedThisTurn: new Set(['new']), history })).toEqual([]);
  });
  it('flags a passage never retrieved and an invented message id', () => {
    const r = { citations: [{ type: 'chunk' as const, chunkId: 'ghost', excerpt: '' }, { type: 'instructor' as const, messageId: 'u9', excerpt: '' }] };
    expect(checkCitations(r, { retrievedThisTurn: new Set(), history })).toHaveLength(2);
  });
});

describe('previousQuestion', () => {
  it('returns the last interviewer question', () => {
    expect(previousQuestion([
      { role: 'assistant', content: JSON.stringify({ question: 'first?' }) },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: JSON.stringify({ question: 'second?' }) },
      { role: 'user', content: 'b' },
    ])).toBe('second?');
  });
});

describe('keepValidCitations', () => {
  it('drops only the citations that fail the check', async () => {
    const { keepValidCitations } = await import('@/lib/ai/agent/interview-controls');
    const r = { citations: [{ type: 'chunk' as const, chunkId: 'ok', excerpt: '' }, { type: 'chunk' as const, chunkId: 'ghost', excerpt: '' }] };
    const out = keepValidCitations(r, { retrievedThisTurn: new Set(['ok']), history: { messageIds: new Set(), chunkIds: new Set() } });
    expect(out.citations.map(c => c.chunkId)).toEqual(['ok']);
  });
});

describe('repairCitations (Part 2 Task 5)', () => {
  const messages = [
    { role: 'user', content: '[messageId=m-1]\nStudents present to the project client as well as the class.' },
    { role: 'assistant', content: '{"question":"q"}' },
    { role: 'user', content: '[messageId=m-2]\nThey revise the menu twice before the final submission.' },
  ];
  const allowed = (ids: string[]) => ({ retrievedThisTurn: new Set<string>(), history: { messageIds: new Set(ids), chunkIds: new Set<string>() } });

  it('re-points an invented messageId when the quote matches one answer', async () => {
    const { repairCitations } = await import('@/lib/ai/agent/interview-controls');
    const out = repairCitations({ citations: [{ type: 'instructor', messageId: 'invented-9', chunkId: null, excerpt: 'revise the menu twice' }] }, messages);
    expect(out.citations[0]!.messageId).toBe('m-2');
  });

  it('drops it when the quote matches none or several', async () => {
    const { repairCitations, keepValidCitations } = await import('@/lib/ai/agent/interview-controls');
    const dup = [...messages, { role: 'user', content: '[messageId=m-3]\nThey revise the menu twice, as before.' }];
    const r = repairCitations({ citations: [
      { type: 'instructor' as const, messageId: 'x1', chunkId: null, excerpt: 'never said anything like this' },
      { type: 'instructor' as const, messageId: 'x2', chunkId: null, excerpt: 'revise the menu twice' },
    ] }, dup);
    expect((keepValidCitations(r as never, allowed(['m-1', 'm-2', 'm-3'])) as { citations: unknown[] }).citations).toEqual([]);
  });

  it('trims a long quote to 200 characters at a word boundary', async () => {
    const { repairCitations } = await import('@/lib/ai/agent/interview-controls');
    const long = 'word '.repeat(60).trim();
    const out = repairCitations({ citations: [{ type: 'chunk', chunkId: 'c', messageId: null, excerpt: long }] }, messages);
    const e = out.citations[0]!.excerpt as string;
    expect(e.length).toBeLessThanOrEqual(200);
    expect(e.endsWith('word…')).toBe(true);
  });

  it('a reply with a long quote parses instead of failing validation', async () => {
    const { parseInterviewReply } = await import('@/lib/ai/agent/interview-controls');
    const raw = { finding: 'f', question: 'q', citations: [{ type: 'instructor', messageId: 'invented', chunkId: null, excerpt: 'Students present to the project client as well as the class. ' + 'more '.repeat(50) }], readiness: { score: 40, covered: [], remaining: [], good_enough_to_generate: false } };
    const parsed = parseInterviewReply(raw, messages);
    expect(parsed.citations[0]!.excerpt.length).toBeLessThanOrEqual(200);
  });
});
