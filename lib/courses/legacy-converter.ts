/**
 * Convert legacy Office formats (.doc / .ppt / .xls) to their modern
 * equivalents (.docx / .pptx / .xlsx) by spawning LibreOffice in
 * headless mode.
 *
 * Why this exists: Docling (and the in-process fallbacks mammoth and
 * unpdf) only handle modern Office XML formats. Faculty uploading
 * legacy files would either fail or get a "re-save as modern format"
 * error. With LibreOffice headless available, we transparently convert
 * before passing to the extractor.
 *
 * Constraints:
 *   - Requires LibreOffice (`soffice`) on PATH. Available locally
 *     (`brew install --cask libreoffice`); NOT available on Vercel.
 *     So this only kicks in for the local Mac deploy.
 *   - Spawns a subprocess per conversion. Cold start of soffice is
 *     a few seconds; subsequent calls re-use a cached profile.
 *     Acceptable for the upload path (already async, already slow).
 *   - Writes to a unique tempdir per conversion to avoid races
 *     between concurrent uploads.
 */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Maps a legacy MIME → its modern target format + filter name passed to soffice. */
interface LegacyConversion {
  modernMime: string;
  modernExt: string;       // 'docx' | 'pptx' | 'xlsx'
  sourceExt: string;       // 'doc' | 'ppt' | 'xls'
}

const LEGACY_TO_MODERN: Record<string, LegacyConversion> = {
  'application/msword': {
    modernMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    modernExt: 'docx',
    sourceExt: 'doc',
  },
  'application/vnd.ms-powerpoint': {
    modernMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    modernExt: 'pptx',
    sourceExt: 'ppt',
  },
  'application/vnd.ms-excel': {
    modernMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    modernExt: 'xlsx',
    sourceExt: 'xls',
  },
};

export interface ConvertedLegacyFile {
  fileBytes: Buffer;
  mimeType: string;
  fileName: string;
}

/**
 * Returns true if the given MIME is a legacy Office format the
 * converter knows how to upgrade.
 */
export function isLegacyOfficeMime(mimeType: string): boolean {
  return mimeType in LEGACY_TO_MODERN;
}

/**
 * Converts a legacy Office file to its modern equivalent via
 * LibreOffice headless. Returns the new bytes + MIME + filename
 * (filename gets the `.docx` etc. extension swapped in so downstream
 * extractors find the right format hint).
 *
 * Throws on:
 *   - Unknown legacy MIME (caller should pre-check with isLegacyOfficeMime)
 *   - soffice not installed
 *   - Conversion failure (timeout, malformed input, etc.)
 */
export async function convertLegacyToModern(
  fileBytes: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ConvertedLegacyFile> {
  const target = LEGACY_TO_MODERN[mimeType];
  if (!target) {
    throw new Error(`convertLegacyToModern: not a legacy Office MIME (${mimeType})`);
  }

  // Unique tempdir per conversion to avoid races between concurrent
  // uploads. We clean it up after — even on error — via the finally block.
  const dir = await mkdtemp(join(tmpdir(), 'docling-libreconv-'));
  try {
    const inputName = `input.${target.sourceExt}`;
    const inputPath = join(dir, inputName);
    await writeFile(inputPath, fileBytes);

    await runSoffice(dir, inputPath, target.modernExt);

    // soffice writes <basename>.<targetext> next to the input. Find it
    // robustly by scanning the dir for the produced file rather than
    // assuming exactly one output name.
    const outputs = (await readdir(dir)).filter(f =>
      f.endsWith(`.${target.modernExt}`) && f !== inputName,
    );
    if (outputs.length === 0) {
      throw new Error(`LibreOffice produced no .${target.modernExt} output`);
    }
    const outputPath = join(dir, outputs[0]!);
    const out = await readFile(outputPath);
    const stem = fileName.replace(new RegExp(`\\.${target.sourceExt}$`, 'i'), '');
    return {
      fileBytes: out,
      mimeType: target.modernMime,
      fileName: `${stem}.${target.modernExt}`,
    };
  } finally {
    // Best-effort cleanup. Don't let cleanup failure mask the real error.
    await rm(dir, { recursive: true, force: true }).catch(() => { /* ignore */ });
  }
}

/**
 * Spawns soffice headless. Wraps spawn() in a promise with timeout
 * (60s) and proper error capture from stderr.
 *
 * Note: each soffice invocation creates a UserInstallation dir to hold
 * its profile. We point this at the workdir so concurrent conversions
 * don't fight over a shared default profile.
 */
async function runSoffice(workdir: string, inputPath: string, targetExt: string): Promise<void> {
  const profileDir = join(workdir, 'profile');
  await mkdir(profileDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'soffice',
      [
        '--headless',
        `-env:UserInstallation=file://${profileDir}`,
        '--convert-to',
        targetExt,
        '--outdir',
        workdir,
        inputPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('LibreOffice conversion timed out after 60s'));
    }, 60_000);
    proc.on('error', (e: Error) => {
      clearTimeout(timer);
      // ENOENT means soffice isn't on PATH.
      const msg = (e as Error & { code?: string }).code === 'ENOENT'
        ? 'LibreOffice (soffice) not installed. Install with `brew install --cask libreoffice`.'
        : e.message;
      reject(new Error(msg));
    });
    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`soffice exit ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}
