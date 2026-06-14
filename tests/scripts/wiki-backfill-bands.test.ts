import { describe, it, expect } from 'vitest';
import { backfillContent } from '@/scripts/wiki-backfill-bands';

describe('backfillContent', () => {
  it('stamps evidence_bands from prose markers when the field is absent', () => {
    const out = backfillContent('---\ntype: course\n---\n\nA ·materials and B ·artifact');
    expect(out).toContain('evidence_bands: [materials_supported, artifact_verified]');
  });
  it('stamps [] when there are no markers', () => {
    expect(backfillContent('---\ntype: course\n---\n\nno markers')).toContain('evidence_bands: []');
  });
  it('is idempotent — already-stamped content is returned unchanged', () => {
    const stamped = '---\ntype: course\nevidence_bands: [claimed]\n---\n\nX ·claimed';
    expect(backfillContent(stamped)).toBe(stamped);
  });
});
