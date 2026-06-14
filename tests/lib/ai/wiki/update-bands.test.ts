import { describe, it, expect } from 'vitest';
import { stampEvidenceBands, dedupeBands } from '@/lib/ai/wiki/update';

describe('dedupeBands', () => {
  it('filters null, dedupes, and orders by the ladder', () => {
    expect(dedupeBands(['artifact_verified', null, 'claimed', 'claimed', null, 'materials_supported']))
      .toEqual(['claimed', 'materials_supported', 'artifact_verified']);
  });
  it('returns [] for all-null / empty', () => {
    expect(dedupeBands([null, null])).toEqual([]);
    expect(dedupeBands([])).toEqual([]);
  });
});

describe('stampEvidenceBands', () => {
  it('appends the field into an existing frontmatter block', () => {
    const out = stampEvidenceBands('---\ntype: course\ninput_hash: abc\n---\n\nBody', ['claimed', 'artifact_verified']);
    expect(out).toContain('evidence_bands: [claimed, artifact_verified]');
    expect(out).toContain('input_hash: abc');
    expect(out).toContain('\nBody');
  });
  it('replaces an existing field rather than duplicating it', () => {
    const out = stampEvidenceBands('---\ntype: course\nevidence_bands: [claimed]\n---\n\nB', ['materials_supported']);
    expect(out.match(/evidence_bands:/g)).toHaveLength(1);
    expect(out).toContain('evidence_bands: [materials_supported]');
  });
  it('prepends a frontmatter block when the page has none', () => {
    const out = stampEvidenceBands('# Title\n\nBody', ['claimed']);
    expect(out.startsWith('---\nevidence_bands: [claimed]\n---\n')).toBe(true);
  });
  it('writes an empty list as []', () => {
    const out = stampEvidenceBands('---\ntype: course\n---\n\nB', []);
    expect(out).toContain('evidence_bands: []');
  });
});
