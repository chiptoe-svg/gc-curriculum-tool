import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The interviewer prompt as tested in the 2026-10-27 replays (the "list" arm):
// summaries are not citable evidence, and the at-rest context is a material
// list after the opening turn.
const prompt = readFileSync(path.join(process.cwd(), 'lib/ai/prompts/capture-chat-agent.md'), 'utf8');

describe('capture-chat-agent prompt: retrieval', () => {
  it('says a digest or list entry is not evidence and cannot be cited', () => {
    expect(prompt).toContain('It is not evidence and it cannot be cited.');
  });

  it('describes the material list given after the opening turn', () => {
    expect(prompt).toContain('**Material list**');
    expect(prompt).not.toContain('- **Per-material digests** — one ~1500-token');
  });

  it('no longer tells the interviewer to skip retrieval when the digest answers', () => {
    expect(prompt).not.toContain('The digest already answers the question precisely.');
  });
});
