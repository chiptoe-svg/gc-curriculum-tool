import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Three interviewer rules taken from the Primer comparison
// (docs/superpowers/specs/2026-11-21-interview-ideas-from-primer-design.md, items 1-3).
const prompt = readFileSync(path.join(process.cwd(), 'lib/ai/prompts/capture-chat-agent.md'), 'utf8').replace(/\s+/g, ' ');

describe('capture-chat-agent prompt: Primer ideas', () => {
  it('checks before writing the question', () => {
    expect(prompt).toContain('**Check before you write the `question`.**');
    expect(prompt).toContain('what the last answer changed');
    expect(prompt).toContain('the single most important thing to ask next');
    expect(prompt).toContain('Never ask again about something the instructor has already answered or declined');
  });
  it('skips experience-dependent questions for a first-time instructor or new course', () => {
    expect(prompt).toContain('**First-time instructor or new course.**');
    expect(prompt).toContain('recorded as expectation');
  });
  it('answers the instructor\'s own question first', () => {
    expect(prompt).toContain('**When the instructor asks you something, answer it first.**');
    expect(prompt).toContain('if X is enough, move off X');
    expect(prompt).toContain('rephrase it in plain words; do not repeat it.');
  });
  it('opens the synthesis turn with progress in words', () => {
    expect(prompt).toContain('opens with one plain line about progress derived from `readiness.score`');
    expect(prompt).toContain("We're about halfway.");
  });
});
