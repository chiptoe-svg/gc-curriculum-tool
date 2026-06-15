import { describe, it, expect } from 'vitest';
import { okfDocument } from '@/lib/okf/okf-doc';

describe('okfDocument', () => {
  it('emits all 7 OKF required keys, extras, and the body', () => {
    const md = okfDocument(
      {
        type: 'material',
        title: 'Syllabus.pdf',
        description: 'Captured material',
        slug: 'syllabus-pdf',
        tags: ['material', 'gc-2400'],
        timestamp: '2026-06-15T00:00:00.000Z',
        resource: 'http://host/view/GC%202400',
        extra: { ignored: 'true', mime: 'application/pdf' },
      },
      'Body text here.',
    );
    expect(md.startsWith('---\n')).toBe(true);
    for (const k of ['type', 'title', 'description', 'slug', 'tags', 'timestamp', 'resource']) {
      expect(md).toMatch(new RegExp(`^${k}:`, 'm'));
    }
    expect(md).toMatch(/^type: material$/m);
    expect(md).toMatch(/^tags: \[material, gc-2400\]$/m);
    expect(md).toMatch(/^ignored: true$/m);
    expect(md).toMatch(/^mime: application\/pdf$/m);
    expect(md.trimEnd().endsWith('Body text here.')).toBe(true);
  });
});
