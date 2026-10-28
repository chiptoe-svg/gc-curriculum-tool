import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { UPLOADABLE_KINDS } from '@/lib/courses/upload-types';

// The interviewer asked instructors to "upload the CSV here in the chat",
// which the chat cannot take (GC 3400, 2026-08-14). It now offers the two
// ways that work, and names the file kinds the Materials pickers accept.
const prompt = readFileSync(path.join(process.cwd(), 'lib/ai/prompts/capture-chat-agent.md'), 'utf8');

describe('capture-chat-agent prompt: getting a document from the instructor', () => {
  it('never asks for a file in the chat', () => {
    expect(prompt).toContain('Never ask the instructor to upload or attach a file in the chat.');
  });
  it('offers pasting and adding the file under Materials', () => {
    expect(prompt).toContain('**Paste it into the reply box**');
    expect(prompt).toContain('**Add the file under Materials**');
  });
  it('names the kinds the pickers accept', () => {
    expect(prompt.replace(/\s+/g, ' ')).toContain(`(${UPLOADABLE_KINDS})`);
  });
});
