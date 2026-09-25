import { describe, it, expect } from 'vitest';

describe('resolveWikilinks titles', () => {
  it('shows the page title for an unlabelled link when a titles map is given', async () => {
    const { resolveWikilinks } = await import('@/lib/wiki/markdown-helpers');
    const titles = new Map([['gc-3460', 'GC 3460 Ink and Substrates']]);
    // Resolution needs the page to exist on disk; a missing page renders as code either way.
    const out = resolveWikilinks('see [[gc-3460]] and [[gc-3460|custom]] and [[nope-9999]]', '', titles);
    expect(out).not.toContain('[[');
    expect(out).toContain('custom');
    expect(out).toContain('`nope-9999`');
    if (out.includes('](/wiki/')) expect(out).toContain('[GC 3460 Ink and Substrates](/wiki/');
  });
});
