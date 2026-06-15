import { describe, it, expect } from 'vitest';
import { materialToOkfMarkdown } from '@/lib/okf/material-to-okf';

const base = {
  fileName: 'Canvas File: Reading.pdf',
  extractedText: 'Chapter 1. The basics.',
  ignored: false,
  mimeType: 'application/pdf',
  uploadedAt: new Date('2026-06-15T12:00:00.000Z'),
};

describe('materialToOkfMarkdown', () => {
  it('frames the material as OKF type: material with the extracted text body', () => {
    const md = materialToOkfMarkdown(base, { resource: 'http://h/view/GC%202400' });
    expect(md).toMatch(/^type: material$/m);
    expect(md).toMatch(/^title: "Canvas File: Reading\.pdf"$/m);
    expect(md).toMatch(/^timestamp: 2026-06-15T12:00:00\.000Z$/m);
    expect(md).toMatch(/^mime: application\/pdf$/m);
    expect(md).toContain('Chapter 1. The basics.');
    expect(md).not.toMatch(/^ignored:/m);
  });

  it('marks set-aside materials with ignored: true', () => {
    const md = materialToOkfMarkdown({ ...base, ignored: true }, { resource: 'http://h/view/GC%202400' });
    expect(md).toMatch(/^ignored: true$/m);
  });
});
