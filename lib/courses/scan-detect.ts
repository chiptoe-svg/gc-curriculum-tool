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
 * Uses `unpdf` (already a dependency, wraps pdfjs-dist) rather than adding
 * a new PDF library: `getMeta` reads the Producer/Creator info dict, and
 * `extractImages` walks each page's operator list — which pdf.js already
 * inlines nested Form XObjects into — to find painted images and their
 * declared pixel dimensions. No new runtime dependency needed.
 *
 * Never throws: an unreadable PDF is 'unknown', and the caller then uses
 * Docling's defaults (force_ocr left off).
 */
import { getDocumentProxy, getMeta, extractImages } from 'unpdf';

export interface ScanVerdict {
  kind: 'scanned' | 'digital' | 'unknown';
  reason: string;
}

const SCANNER_RE =
  /\b(scan(?:ner|ned)?|scansnap|paperport|abbyy|finereader|readiris|kofax|capture)\b|scan plug-?in/i;
const MIN_IMAGE_LONG_EDGE_PX = 500;
const ASPECT_TOLERANCE = 0.03;
const SCANNED_PAGE_SHARE = 0.8;

type PdfProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

async function isFullPageImagePage(pdf: PdfProxy, pageNumber: number): Promise<boolean> {
  const page = await pdf.getPage(pageNumber);
  const { width, height } = page.getViewport({ scale: 1 });
  if (width <= 0 || height <= 0) return false;
  const pageAspect = width / height;
  const images = await extractImages(pdf, pageNumber);
  for (const { width: imgW, height: imgH } of images) {
    if (imgH <= 0 || Math.max(imgW, imgH) < MIN_IMAGE_LONG_EDGE_PX) continue;
    if (Math.abs(imgW / imgH - pageAspect) / pageAspect < ASPECT_TOLERANCE) return true;
  }
  return false;
}

export async function detectScan(pdfBytes: Uint8Array | Buffer, samplePages = 5): Promise<ScanVerdict> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
    const { info } = await getMeta(pdf);
    const producer = [info.Producer, info.Creator].filter(Boolean).join(' | ');
    const match = producer.match(SCANNER_RE);
    if (match) {
      return { kind: 'scanned', reason: `producer word ${JSON.stringify(match[0])}` };
    }
    const n = Math.min(samplePages, pdf.numPages);
    let hits = 0;
    for (let i = 1; i <= n; i++) {
      if (await isFullPageImagePage(pdf, i)) hits++;
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
