/**
 * Is this PDF a scan? Decides whether Docling must force OCR over its own
 * text layer.
 *
 * Ported from rag-core's `scan_detect.py` (rag-core main `b78a309`) — same
 * logic, same thresholds, same test cases. Docling-serve 1.36 (the Spark,
 * confirmed live 2026-10-05) trusts a scanned PDF's embedded OCR text layer
 * by default and interleaves the columns of a scanned multi-column page;
 * `force_ocr=true` fixes it but makes born-digital PDFs worse (replaces a
 * perfect text layer), so the decision is made per document here.
 *
 * Rule: Producer/Creator metadata contains a whole scanner word, OR >=80%
 * of the first 5 pages are a single full-page image (aspect within 3% of
 * the page, long edge >=500px, walking nested Form XObjects) -> 'scanned'.
 *
 * Uses `pdf-lib` (moved from a devDependency to a runtime dependency —
 * see package.json comment) rather than `unpdf`/pdfjs-dist: reading the
 * page geometry and image dimensions needs raw PDF *object-dictionary*
 * access — the page's own MediaBox array, and each XObject's declared
 * /Width and /Height entries — without decoding anything. pdf-lib exposes
 * that dict-level model directly (PDFPage.getMediaBox(), PDFDict.lookup),
 * the same level pypdf operates at in the Python original. pdfjs-dist is a
 * *rendering* engine: reading an image's dimensions through it (unpdf's
 * `extractImages`) means fully decoding the bitmap, which is both slow
 * (full pixel decode for every sampled image) and wrong — a page's
 * declared /Rotate is a *display* instruction that pdfjs's
 * `getViewport()` factors into width/height, but the image was placed
 * against the page's unrotated MediaBox, so a rotated scanned page's
 * aspect ratio stopped matching and such pages were missed (review
 * finding, 2026-10-06). pdf-lib's getMediaBox() is the raw, unrotated box,
 * matching pypdf's `page.mediabox` exactly.
 *
 * Never throws: an unreadable PDF is 'unknown', and the caller then uses
 * Docling's defaults (force_ocr left off).
 */
import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFStream, type PDFPage } from 'pdf-lib';

export interface ScanVerdict {
  kind: 'scanned' | 'digital' | 'unknown';
  reason: string;
}

const SCANNER_RE =
  /\b(scan(?:ner|ned)?|scansnap|paperport|abbyy|finereader|readiris|kofax|capture)\b|scan plug-?in/i;
const MIN_IMAGE_LONG_EDGE_PX = 500;
const ASPECT_TOLERANCE = 0.03;
const SCANNED_PAGE_SHARE = 0.8;
// Matches rag-core's _MAX_FORM_DEPTH: a scanner never nests a page image more
// than a level or two deep; this just bounds a pathological/malicious PDF's
// recursion (we're walking the object graph ourselves now, not pdf.js's).
const MAX_FORM_DEPTH = 3;

const SUBTYPE = PDFName.of('Subtype');
const WIDTH = PDFName.of('Width');
const HEIGHT = PDFName.of('Height');
const IMAGE = PDFName.of('Image');
const FORM = PDFName.of('Form');

function imageSizes(xobjects: PDFDict | undefined, depth = 0): Array<{ width: number; height: number }> {
  if (!xobjects) return [];
  const sizes: Array<{ width: number; height: number }> = [];
  for (const key of xobjects.keys()) {
    const obj = xobjects.lookupMaybe(key, PDFStream);
    if (!obj) continue;
    const subtype = obj.dict.lookupMaybe(SUBTYPE, PDFName);
    if (subtype === IMAGE) {
      const width = obj.dict.lookupMaybe(WIDTH, PDFNumber)?.asNumber() ?? 0;
      const height = obj.dict.lookupMaybe(HEIGHT, PDFNumber)?.asNumber() ?? 0;
      sizes.push({ width, height });
    } else if (subtype === FORM && depth < MAX_FORM_DEPTH) {
      const nestedResources = obj.dict.lookupMaybe(PDFName.Resources, PDFDict);
      const nestedXObjects = nestedResources?.lookupMaybe(PDFName.XObject, PDFDict);
      sizes.push(...imageSizes(nestedXObjects, depth + 1));
    }
  }
  return sizes;
}

function isFullPageImagePage(page: PDFPage): boolean {
  const { width, height } = page.getMediaBox(); // raw, unrotated box — matches pypdf's page.mediabox
  if (width <= 0 || height <= 0) return false;
  const pageAspect = width / height;
  const xobjects = page.node.Resources()?.lookupMaybe(PDFName.XObject, PDFDict);
  for (const { width: imgW, height: imgH } of imageSizes(xobjects)) {
    if (imgH <= 0 || Math.max(imgW, imgH) < MIN_IMAGE_LONG_EDGE_PX) continue;
    if (Math.abs(imgW / imgH - pageAspect) / pageAspect < ASPECT_TOLERANCE) return true;
  }
  return false;
}

export async function detectScan(pdfBytes: Uint8Array | Buffer, samplePages = 5): Promise<ScanVerdict> {
  try {
    // updateMetadata defaults to true and would stamp pdf-lib's own Producer
    // string over the document's real one before we get to read it — fatal
    // for the metadata rule, which is our cheapest and most reliable signal.
    const doc = await PDFDocument.load(pdfBytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
    const producer = [doc.getProducer(), doc.getCreator()].filter(Boolean).join(' | ');
    const match = producer.match(SCANNER_RE);
    if (match) {
      return { kind: 'scanned', reason: `producer word ${JSON.stringify(match[0])}` };
    }
    const pages = doc.getPages();
    const n = Math.min(samplePages, pages.length);
    let hits = 0;
    for (const page of pages.slice(0, n)) {
      if (isFullPageImagePage(page)) hits++;
    }
    if (n > 0 && hits / n >= SCANNED_PAGE_SHARE) {
      return { kind: 'scanned', reason: `full-page images on ${hits}/${n} sampled pages` };
    }
    return { kind: 'digital', reason: `full-page images on ${hits}/${n} sampled pages` };
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name : 'Error';
    return { kind: 'unknown', reason: `unreadable: ${name}` };
  }
}
