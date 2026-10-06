// @vitest-environment node
//
// Ported from rag-core's tests/extract/test_scan_detect.py (rag-core main
// b78a309) — same 8 cases, same thresholds. Runs the REAL unpdf/pdfjs parser
// against hand-built fixture PDFs (via pdf-lib + sharp), not a mock, because
// the point of this port is verifying the heuristic against real PDF
// structure (Producer/Creator metadata, XObject image dimensions).
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFRawStream, degrees } from 'pdf-lib';
import sharp from 'sharp';
import { detectScan } from '@/lib/courses/scan-detect';

async function blankPdf(opts: { producer?: string; pages?: number } = {}): Promise<Uint8Array> {
  const { producer, pages = 1 } = opts;
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  if (producer !== undefined) doc.setProducer(producer);
  return doc.save();
}

/** One full-page PNG image per page — the classic scan signature. */
async function imagePdf(pxW: number, pxH: number, pages = 1): Promise<Uint8Array> {
  const png = await sharp({
    create: { width: pxW, height: pxH, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).png().toBuffer();
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const img = await doc.embedPng(png);
    const page = doc.addPage([pxW, pxH]);
    page.drawImage(img, { x: 0, y: 0, width: pxW, height: pxH });
  }
  return doc.save();
}

describe('detectScan', () => {
  it('scanner producer word is scanned', async () => {
    const verdict = await detectScan(await blankPdf({ producer: 'Acrobat 5.0 Scan Plug-in for Macintosh' }));
    expect(verdict.kind).toBe('scanned');
    expect(verdict.reason).toContain('Scan');
  });

  it('full-page images on every sampled page are scanned', async () => {
    const verdict = await detectScan(await imagePdf(1700, 2200, 3));
    expect(verdict.kind).toBe('scanned');
  });

  it('a low-resolution (72dpi) full-page image is still scanned', async () => {
    // A 612x792 px page image was missed by a 1000px floor in an earlier draft.
    const verdict = await detectScan(await imagePdf(612, 792));
    expect(verdict.kind).toBe('scanned');
  });

  it('a born-digital producer is digital', async () => {
    const verdict = await detectScan(await blankPdf({ producer: 'pdfTeX-1.40.25' }));
    expect(verdict.kind).toBe('digital');
  });

  it('word boundary prevents a false positive ("scandium" is not "scan")', async () => {
    const verdict = await detectScan(await blankPdf({ producer: 'Pdfscandium Writer 3' }));
    expect(verdict.kind).toBe('digital');
  });

  it('one full-page figure in an otherwise-text paper stays digital', async () => {
    // 1 of 5 sampled pages being a full-page image is a figure, not a scan.
    const doc = await PDFDocument.create();
    for (let i = 0; i < 4; i++) doc.addPage([612, 792]);
    const png = await sharp({
      create: { width: 1700, height: 2200, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();
    const img = await doc.embedPng(png);
    const page = doc.addPage([1700, 2200]);
    page.drawImage(img, { x: 0, y: 0, width: 1700, height: 2200 });
    const verdict = await detectScan(await doc.save());
    expect(verdict.kind).toBe('digital');
  });

  it('a rotated page (/Rotate 90) with a full-page image is still scanned — geometry must use the unrotated MediaBox, matching pypdf', async () => {
    // The image fills the page's own (unrotated) MediaBox exactly. /Rotate is a
    // display instruction only; it must not be consulted when comparing the
    // image's aspect ratio to the page's aspect ratio (review finding #1 —
    // getViewport({scale:1}) is rotation-adjusted and swaps width/height for a
    // 90/270 rotation, which breaks the aspect match pypdf's page.mediabox does
    // not have this problem with).
    const doc = await PDFDocument.create();
    const png = await sharp({
      create: { width: 1700, height: 2200, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();
    const img = await doc.embedPng(png);
    const page = doc.addPage([1700, 2200]);
    page.drawImage(img, { x: 0, y: 0, width: 1700, height: 2200 });
    page.setRotation(degrees(90));
    const verdict = await detectScan(await doc.save());
    expect(verdict.kind).toBe('scanned');
  });

  it('reads image dimensions from the XObject dict without decoding the stream (an undecodable DCTDecode blob with a correct dict is still scanned)', async () => {
    // Review findings #3/#4: dimensions must come from /Width and /Height in the
    // XObject dictionary, never from actually decoding the image bitmap. Prove it
    // by giving a page an "image" whose declared Filter is DCTDecode (JPEG) but
    // whose stream bytes are garbage — not valid JPEG at all. A decode-based
    // implementation would fail to decode (and either throw or silently miss the
    // image); a dict-only implementation reads Width/Height straight off the
    // dictionary and never touches the stream bytes.
    const doc = await PDFDocument.create();
    const page = doc.addPage([1700, 2200]);
    const garbage = new Uint8Array(64).map((_, i) => i * 7 + 1); // not valid JPEG data
    const dict = doc.context.obj({
      Type: 'XObject',
      Subtype: 'Image',
      Width: 1700,
      Height: 2200,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      Filter: 'DCTDecode',
      Length: garbage.length,
    });
    const stream = PDFRawStream.of(dict, garbage);
    const ref = doc.context.register(stream);
    page.node.newXObject('FakeScan', ref);
    const verdict = await detectScan(await doc.save());
    expect(verdict.kind).toBe('scanned');
  });

  it('a truncated PDF is unknown, not a thrown exception', async () => {
    const full = await blankPdf();
    const truncated = full.slice(0, 40);
    const verdict = await detectScan(truncated);
    expect(verdict.kind).toBe('unknown');
    expect(verdict.reason).toMatch(/^unreadable/);
  });

  it('non-PDF bytes are unknown', async () => {
    const verdict = await detectScan(new TextEncoder().encode('<html>error page</html>'));
    expect(verdict.kind).toBe('unknown');
  });
});
