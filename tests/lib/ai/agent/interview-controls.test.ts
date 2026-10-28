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
