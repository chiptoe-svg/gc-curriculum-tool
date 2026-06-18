import { describe, it, expect } from 'vitest';
import { probeSize } from '@/lib/capture/size-probe';

describe('probeSize', () => {
  it('returns sizeBytes for an unknown type with no count', async () => {
    const buf = Buffer.from('hello');
    const r = await probeSize(buf, 'text/plain');
    expect(r.sizeBytes).toBe(5);
    expect(r.pageCount).toBeUndefined();
    expect(r.slideCount).toBeUndefined();
  });

  it('counts PPTX slides from the zip without extraction', async () => {
    const yazl = await import('yazl');
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('<p/>'), 'ppt/slides/slide1.xml');
    zip.addBuffer(Buffer.from('<p/>'), 'ppt/slides/slide2.xml');
    zip.addBuffer(Buffer.from('x'), 'ppt/presentation.xml');
    zip.end();
    const chunks: Buffer[] = [];
    const buf: Buffer = await new Promise((res) => {
      zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
      zip.outputStream.on('end', () => res(Buffer.concat(chunks)));
    });
    const r = await probeSize(buf, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(r.slideCount).toBe(2);
  });

  it('never throws on a malformed file — falls back to sizeBytes only', async () => {
    const r = await probeSize(Buffer.from('not a real pdf'), 'application/pdf');
    expect(r.sizeBytes).toBe(14);
    expect(r.pageCount).toBeUndefined();
  });
});
