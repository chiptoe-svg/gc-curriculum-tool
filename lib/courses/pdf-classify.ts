/**
 * Cheap CPU-only PDF classification for extraction routing (issue #4).
 *
 * Image-heavy PDFs (design slide decks) crash the standard Docling GPU pipeline
 * on the Spark GB10 — the whole-deck raster hits a CUDA op before any model-side
 * resize. We detect them here, BEFORE Docling runs, and route them to the qwen
 * per-page vision path instead. Geometry first (the robust signal — decks are
 * 16:9 / oversized), text density second. Any probe error → treat as image-heavy
 * (confusion → qwen), since the downside of a false positive is only a slower
 * (but correct) extraction, while a false negative is a hard crash.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileP = promisify(execFile);
const MIN_CHARS_PER_PAGE = 100; // mirror extract-text.ts

/** Deck-shaped: 16:9-ish landscape OR an oversized page. Sizes in points (1pt = 1/72"). */
export function isDeckGeometry(widthPt: number, heightPt: number): boolean {
  if (!(widthPt > 0) || !(heightPt > 0)) return false;
  const longEdge = Math.max(widthPt, heightPt);
  const aspect = longEdge / Math.min(widthPt, heightPt);
  const landscapeWide = widthPt >= heightPt && aspect >= 1.6; // 16:10=1.6, 16:9=1.78
  const oversized = longEdge > 1500; // ≫ letter(792)/A4(842)
  return landscapeWide || oversized;
}

export async function pdfPageInfo(
  bytes: Buffer,
): Promise<{ pageCount: number; widthPt: number; heightPt: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'pdfinfo-'));
  const file = join(dir, 'in.pdf');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP('pdfinfo', [file], { timeout: 20_000 });
    const pageCount = Number(/Pages:\s+(\d+)/.exec(stdout)?.[1] ?? 0);
    const sz = /Page size:\s+([\d.]+)\s+x\s+([\d.]+)/.exec(stdout);
    return { pageCount, widthPt: Number(sz?.[1] ?? 0), heightPt: Number(sz?.[2] ?? 0) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function charsPerPage(bytes: Buffer, pageCount: number): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'pdftotext-'));
  const file = join(dir, 'in.pdf');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP('pdftotext', [file, '-'], {
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return pageCount > 0 ? stdout.length / pageCount : stdout.length;
  } catch {
    return 0; // pdftotext failure ⇒ treat as sparse ⇒ image-heavy
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Geometry first, density second. Only a CONFIRMED signal returns true.
 *
 * A probe error (unparseable / non-PDF / encrypted bytes) returns FALSE — routed to the
 * normal Docling pipeline, not force-qwen. Rationale: the crash we guard against is an
 * oversized *render*, and every valid PDF — including a 40 MB image deck — has a
 * readable structure `pdfinfo` parses fine (it reads page boxes, never renders). So a
 * genuine crash-case deck is always detectable via geometry; a `pdfinfo` failure means
 * bytes that aren't a valid deck at all. Trust the existing pipeline for those (the
 * `images_scale` cap on the standard pipeline is the crash backstop for any misroute).
 */
export async function isImageHeavyPdf(bytes: Buffer): Promise<boolean> {
  let info: { pageCount: number; widthPt: number; heightPt: number };
  try {
    info = await pdfPageInfo(bytes);
  } catch {
    return false; // unparseable → normal pipeline (images_scale cap backstops the crash)
  }
  if (isDeckGeometry(info.widthPt, info.heightPt)) return true;
  try {
    return (await charsPerPage(bytes, info.pageCount)) < MIN_CHARS_PER_PAGE;
  } catch {
    return false;
  }
}
