import { describe, it, expect } from 'vitest';
import { chooseStaged, stagedFromStoredReply } from '../ui-mode';

describe('chooseStaged', () => {
  it('?interview=staged forces staged', () => {
    expect(chooseStaged('staged', undefined)).toBe(true);
    expect(chooseStaged('staged', 'off')).toBe(true);
    expect(chooseStaged('staged', 'on')).toBe(true);
  });
  it('INTERVIEW_STAGED_DEFAULT=on makes staged the default unless ?interview=classic', () => {
    expect(chooseStaged(undefined, 'on')).toBe(true);
    expect(chooseStaged('classic', 'on')).toBe(false);
    expect(chooseStaged('anything', 'on')).toBe(true);
  });
  it('is classic by default', () => {
    expect(chooseStaged(undefined, undefined)).toBe(false);
    expect(chooseStaged(undefined, 'off')).toBe(false);
    expect(chooseStaged(undefined, '1')).toBe(false);
    expect(chooseStaged('classic', undefined)).toBe(false);
  });
});

describe('stagedFromStoredReply', () => {
  const staged = {
    stage: 2, stageTitle: 'Evidence walk', questionsAsked: 3, cap: 20, slotAsked: 'conditions', kind: 'question',
    stageProgress: [1, 2, 3, 4, 5, 6].map(id => ({ id, title: `t${id}`, status: id < 2 ? 'done' : id === 2 ? 'active' : 'upcoming' })),
  };
  it('reads the staged block from a stored reply', () => {
    expect(stagedFromStoredReply(JSON.stringify({ finding: 'f', question: 'q', staged }))?.stage).toBe(2);
  });
  it('is null for classic replies, junk and empty', () => {
    expect(stagedFromStoredReply(JSON.stringify({ finding: 'f', question: 'q' }))).toBeNull();
    expect(stagedFromStoredReply('not json')).toBeNull();
    expect(stagedFromStoredReply(null)).toBeNull();
    expect(stagedFromStoredReply(JSON.stringify({ staged: { stage: 9 } }))).toBeNull();
  });
});
