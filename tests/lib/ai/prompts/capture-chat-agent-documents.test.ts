import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { UPLOADABLE_KINDS } from '@/lib/courses/upload-types';

// The interviewer asked instructors to "upload the CSV here in the chat",
// which the chat cannot take (GC 3400, 2026-08-14). It now offers the two
// ways that work, and names the file kinds the Materials pickers accept.
const prompt = readFileSync(path.join(process.cwd(), 'lib/ai/prompts/capture-chat-agent.md'), 'utf8');

describe('capture-chat-agent prompt: getting a document from the instructor', () => {
  it('no longer forbids asking for a file and names the button', () => {
    expect(prompt).not.toContain('Never ask the instructor to upload');
    expect(prompt).not.toContain('cannot receive a file');
    expect(prompt).toContain('"Add a file" button beside Voice');
    expect(prompt).toContain('[Instructor added a file:');
    expect(prompt).toContain('search it before answering');
  });
  it('still offers pasting', () => {
    expect(prompt).toContain('the key part pasted into the reply box');
  });
  it('names the kinds the pickers accept', () => {
    expect(prompt.replace(/\s+/g, ' ')).toContain(`(${UPLOADABLE_KINDS})`);
  });
});
