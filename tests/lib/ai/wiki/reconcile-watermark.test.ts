import { describe, it, expect } from 'vitest';
import {
  missingPagePaths,
  computeInputHash,
  stampInputHash,
} from '@/lib/ai/wiki/update';

// Pure helpers for increment C — no I/O, no DB.

describe('missingPagePaths', () => {
  const requested = [
    { path: 'courses/gc-1040.md' },
    { path: 'index.md' },
    { path: 'competencies/s1.md' },
  ];

  it('returns paths the model never produced', () => {
    const produced = [
      { path: 'courses/gc-1040.md' },
      { path: 'index.md' },
      // competencies/s1.md silently dropped
    ];
    expect(missingPagePaths(requested, produced)).toEqual(['competencies/s1.md']);
  });

  it('counts an "unchanged" page as produced (the model accounted for it)', () => {
    const produced = [
      { path: 'courses/gc-1040.md' },
      { path: 'index.md' },
      { path: 'competencies/s1.md' },
    ];
    expect(missingPagePaths(requested, produced)).toEqual([]);
  });

  it('ignores extra/unrequested produced paths', () => {
    const produced = [
      { path: 'courses/gc-1040.md' },
      { path: 'index.md' },
      { path: 'competencies/s1.md' },
      { path: 'log.md' }, // not requested — not our concern here
    ];
    expect(missingPagePaths(requested, produced)).toEqual([]);
  });
});

describe('computeInputHash', () => {
  const page = { type: 'competency' as const, slug: 's1', substrate: { contributingCells: [{ d: 4 }] } };

  it('is deterministic for the same inputs', () => {
    expect(computeInputHash('snap-1', page)).toBe(computeInputHash('snap-1', page));
  });

  it('changes when the snapshot id changes', () => {
    expect(computeInputHash('snap-1', page)).not.toBe(computeInputHash('snap-2', page));
  });

  it('changes when the substrate changes (page is now stale)', () => {
    const changed = { ...page, substrate: { contributingCells: [{ d: 5 }] } };
    expect(computeInputHash('snap-1', page)).not.toBe(computeInputHash('snap-1', changed));
  });

  it('produces a short hex watermark', () => {
    expect(computeInputHash('snap-1', page)).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('stampInputHash', () => {
  it('inserts the watermark into existing frontmatter', () => {
    const content = `---\ntype: competency\n---\n# Title\nbody\n`;
    const out = stampInputHash(content, 'abc123');
    expect(out).toContain('type: competency');
    expect(out).toContain('input_hash: abc123');
    // frontmatter block intact, body preserved
    expect(out).toMatch(/^---\n[\s\S]*?\n---\n/);
    expect(out).toContain('# Title');
  });

  it('replaces an existing watermark rather than duplicating it', () => {
    const content = `---\ntype: competency\ninput_hash: old\n---\n# Title\n`;
    const out = stampInputHash(content, 'new999');
    expect(out).toContain('input_hash: new999');
    expect(out).not.toContain('input_hash: old');
    expect(out.match(/input_hash:/g)).toHaveLength(1);
  });

  it('prepends a frontmatter block when the page has none', () => {
    const content = `# Title\nbody\n`;
    const out = stampInputHash(content, 'xyz');
    expect(out.startsWith('---\ninput_hash: xyz\n---\n\n')).toBe(true);
    expect(out).toContain('# Title');
  });
});
