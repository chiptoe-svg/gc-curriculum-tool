import yauzl from 'yauzl';

export interface SizeProbe {
  sizeBytes: number;
  pageCount?: number;   // PDFs
  slideCount?: number;  // PPTX
}

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const SLIDE_RE = /^ppt\/slides\/slide\d+\.xml$/;

/** Cheap size signals with NO text extraction / OCR. Best-effort: any probe
 *  failure degrades to sizeBytes-only — this must never throw. */
export async function probeSize(bytes: Buffer, mimeType: string): Promise<SizeProbe> {
  const sizeBytes = bytes.length;
  try {
    if (mimeType === 'application/pdf') {
      const { getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      return { sizeBytes, pageCount: pdf.numPages };
    }
    if (mimeType === PPTX) {
      return { sizeBytes, slideCount: await countPptxSlides(bytes) };
    }
  } catch {
    /* fall through to sizeBytes-only */
  }
  return { sizeBytes };
}

function countPptxSlides(bytes: Buffer): Promise<number> {
  return new Promise((resolve) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return resolve(0);
      let count = 0;
      zip.on('entry', (e) => { if (SLIDE_RE.test(e.fileName)) count++; zip.readEntry(); });
      zip.on('end', () => resolve(count));
      zip.on('error', () => resolve(count));
      zip.readEntry();
    });
  });
}
