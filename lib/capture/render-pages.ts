/**
 * Page-render utility for tiered ingestion — slide-vision path.
 *
 * Renders a document (PDF, PPTX, PPT, Keynote, or any legacy Office slide
 * format) to a sequence of PNG page images. Each page becomes a Buffer that
 * can be forwarded to a vision model.
 *
 * Rendering pipeline:
 *   PDF → pdftoppm -png -r 150 → page-*.png → Buffer[]
 *   PPTX / PPT / Keynote / legacy-office →
 *       soffice --headless --convert-to pdf → PDF → (same pdftoppm step)
 *
 * Design constraints (mirroring legacy-converter.ts):
 *   - Unique mkdtemp per call to prevent concurrent-upload races.
 *   - Always cleans up (try/finally).
 *   - Never throws — on any failure console.warn + return [].
 *   - Prefers absolute Homebrew paths; falls back to bare name on PATH.
 *   - Caps at MAX_SLIDES = 60 pages; warns (not silently) when truncating.
 *
 * Import style: namespace imports (`* as childProcess`, `* as fs`) so that
 * vi.spyOn / vi.mock can intercept calls in tests (named bindings are live
 * bindings in ESM and cannot be patched from outside the module).
 */

import * as childProcess from 'node:child_process';
import * as nodeFsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isLegacyOfficeMime } from '@/lib/courses/legacy-converter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_SLIDES = 60;

/** Preferred absolute paths — Homebrew on Apple Silicon / Intel. */
const PDFTOPPM_BIN = '/opt/homebrew/bin/pdftoppm';
const SOFFICE_BIN = '/opt/homebrew/bin/soffice';

/**
 * MIME types that are slide decks but not legacy-office: PPTX and Keynote.
 * Legacy PPT is handled by isLegacyOfficeMime from legacy-converter.
 */
const SLIDE_MIME_SET = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.apple.keynote', // .key
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders `bytes` to a sequence of PNG page images.
 *
 * @param bytes    Raw file bytes.
 * @param mimeType MIME type of the input file.
 * @param fileName Original filename (used in warnings only).
 * @returns        Array of PNG Buffers, one per page, in page order.
 *                 Returns [] for unsupported MIME or on any rendering error.
 */
export async function renderToImages(
  bytes: Buffer,
  mimeType: string,
  fileName: string,
): Promise<Buffer[]> {
  // Routing: decide whether to render, and whether soffice is needed first.
  const isPdf = mimeType === 'application/pdf';
  const isSlide = SLIDE_MIME_SET.has(mimeType) || isLegacyOfficeMime(mimeType);

  if (!isPdf && !isSlide) {
    return [];
  }

  const dir = await nodeFsPromises.mkdtemp(join(tmpdir(), 'render-pages-'));
  try {
    // ------------------------------------------------------------------
    // Step 1: Materialise the input to disk.
    // ------------------------------------------------------------------
    const ext = mimeType === 'application/pdf' ? 'pdf'
      : mimeType === 'application/vnd.apple.keynote' ? 'key'
      : mimeType === 'application/vnd.ms-powerpoint' ? 'ppt'
      : 'pptx';
    const inputPath = join(dir, `input.${ext}`);
    await nodeFsPromises.writeFile(inputPath, bytes);

    // ------------------------------------------------------------------
    // Step 2: If it's a slide format, convert to PDF via LibreOffice.
    // ------------------------------------------------------------------
    let pdfPath: string;
    if (isSlide) {
      await runSoffice(dir, inputPath);
      // LibreOffice names the output <basename>.pdf
      const outputs = (await nodeFsPromises.readdir(dir)).filter(
        f => f.endsWith('.pdf') && f !== `input.${ext}`,
      );
      if (outputs.length === 0) {
        console.warn(`[render-pages] soffice produced no PDF output for ${fileName}`);
        return [];
      }
      pdfPath = join(dir, outputs[0]!);
    } else {
      pdfPath = inputPath;
    }

    // ------------------------------------------------------------------
    // Step 3: Render PDF → PNG pages via pdftoppm.
    // ------------------------------------------------------------------
    const pagePrefix = join(dir, 'page');
    await runPdftoppm(pdfPath, pagePrefix);

    // Collect page-*.png files in numeric order.
    const allFiles = await nodeFsPromises.readdir(dir);
    const pageFiles = allFiles
      .filter(f => f.startsWith('page') && f.endsWith('.png'))
      .sort(comparePageFiles);

    // Cap at MAX_SLIDES
    const totalPages = pageFiles.length;
    const renderedFiles = pageFiles.length > MAX_SLIDES
      ? pageFiles.slice(0, MAX_SLIDES)
      : pageFiles;

    if (totalPages > MAX_SLIDES) {
      console.warn(
        `[render-pages] capped at 60 pages for ${fileName} (${totalPages} total)`,
      );
    }

    // Read pages into Buffers
    const buffers = await Promise.all(
      renderedFiles.map(f => nodeFsPromises.readFile(join(dir, f))),
    );
    return buffers;
  } catch (err) {
    console.warn(`[render-pages] rendering failed for ${fileName}:`, err);
    return [];
  } finally {
    // Best-effort cleanup — don't let this mask a real error.
    await nodeFsPromises.rm(dir, { recursive: true, force: true }).catch(() => { /* ignore */ });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Sorts page file names in numeric page order.
 * pdftoppm produces page-1.png, page-2.png … page-10.png (NOT lexicographic).
 */
function comparePageFiles(a: string, b: string): number {
  const numOf = (name: string) => {
    const m = name.match(/(\d+)\.png$/);
    return m ? parseInt(m[1]!, 10) : 0;
  };
  return numOf(a) - numOf(b);
}

/**
 * Runs `pdftoppm -png -r 150 <pdfPath> <pagePrefix>`.
 * Prefers /opt/homebrew/bin/pdftoppm, falls back to bare `pdftoppm`.
 * Timeout: 120 s (large decks can be slow at 150 dpi).
 */
function runPdftoppm(pdfPath: string, pagePrefix: string): Promise<void> {
  return runCommand(PDFTOPPM_BIN, 'pdftoppm', ['-png', '-r', '150', pdfPath, pagePrefix], 120_000);
}

/**
 * Runs `soffice --headless --convert-to pdf --outdir <dir> <inputPath>`.
 * Prefers /opt/homebrew/bin/soffice, falls back to bare `soffice`.
 * Timeout: 120 s.
 */
function runSoffice(workdir: string, inputPath: string): Promise<void> {
  const args = [
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    workdir,
    inputPath,
  ];
  return runCommand(SOFFICE_BIN, 'soffice', args, 120_000);
}

/**
 * Generic command runner.
 * Tries `preferredBin` first; if it gets ENOENT, retries with `fallbackName`
 * (bare name, resolved via PATH).
 */
function runCommand(
  preferredBin: string,
  fallbackName: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  return spawnWithTimeout(preferredBin, args, timeoutMs).catch((err: Error & { code?: string }) => {
    if (err.code === 'ENOENT') {
      return spawnWithTimeout(fallbackName, args, timeoutMs);
    }
    throw err;
  });
}

/** Wraps childProcess.spawn() in a timeout-aware Promise, capturing stderr. */
function spawnWithTimeout(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = childProcess.spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`[render-pages] ${bin} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    proc.on('error', (e: Error & { code?: string }) => {
      clearTimeout(timer);
      const err = Object.assign(new Error(
        e.code === 'ENOENT'
          ? `[render-pages] ${bin} not found (ENOENT)`
          : e.message,
      ), { code: e.code });
      reject(err);
    });
    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`[render-pages] ${bin} exit ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}
