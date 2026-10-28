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

// Search hits carry the chunk id as `id` (SearchHit in lib/capture/vector-store.ts);
// the prompt once described a `chunkId` field the results never had (found 2026-10-28).
describe('capture-chat-agent prompt: chunk citation field', () => {
  it('describes search results with the fields the tools actually return', () => {
    const shape = prompt.match(/^\{ (id, materialId[^}]*)\}$/m);
    expect(shape).not.toBeNull();
    const fields = (shape?.[1] ?? "").split(',').map((s) => s.trim()).filter(Boolean);
    const hit: Record<keyof import('@/lib/capture/vector-store').SearchHit, true> = {
      id: true, materialId: true, courseCode: true, fileName: true, sectionTitle: true, sectionIndex: true, text: true,
      parentSectionId: true, parentSectionText: true, contextBlurb: true, score: true, uploadedAt: true, snapshotId: true,
    };
    for (const f of fields) expect(Object.keys(hit)).toContain(f);
  });
  it('says the chunk id goes in the citation chunkId field', () => {
    expect(prompt).toContain("The chunk's `id` is what you cite: put it in the citation's `chunkId` field");
  });
});
