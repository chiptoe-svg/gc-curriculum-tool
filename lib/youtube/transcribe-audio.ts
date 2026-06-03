/**
 * Whisper fallback for YouTube videos without usable captions.
 *
 * Pipeline (LAN Mac only — partner Vercel deploy has none of these tools):
 *   yt-dlp → audio extract (m4a/wav) → ffmpeg resample 16kHz mono →
 *   mlx_whisper (Apple MLX) → plain text
 *
 * All local. No API calls, no per-minute cost. Runs on the M4 Max via
 * MLX's Metal kernels with the whisper-large-v3-turbo model — about
 * 1/60 realtime in practice (13-min video → ~12s; 30-min lecture → ~30s).
 *
 * History: we previously used whisper.cpp + ggml-medium.en. Migrated to
 * mlx-whisper 2026-06-03 for ~2× speedup and slightly cleaner
 * segmentation. The old whisper.cpp install at /opt/homebrew/bin/whisper-cli
 * is still around for fallback / comparison if needed.
 *
 * Constraints:
 *   - Default 30-minute length cap. Longer videos are likely lectures
 *     someone embedded by reference, not curriculum content the audit
 *     needs verbatim.
 *   - Skip on duration probe failure (private / age-gated / region-locked
 *     videos that yt-dlp can't even inspect).
 *   - Skip when yt-dlp / mlx_whisper are missing — surface as inaccessible
 *     so the caller falls back to the existing "no captions" placeholder.
 *
 * Env overrides (optional; sensible Mac-Homebrew defaults are baked in):
 *   - MLX_WHISPER_PATH         path to mlx_whisper binary
 *   - MLX_WHISPER_MODEL        model id (Hugging Face) or path; default
 *                              mlx-community/whisper-large-v3-turbo
 *   - WHISPER_MAX_DURATION_SEC per-video cap; default 1800 (30 min)
 */

import * as childProcess from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MLX_WHISPER = process.env.MLX_WHISPER_PATH
  ?? path.join(process.env.HOME ?? '/Users/admin', '.local/bin/mlx_whisper');
const MLX_WHISPER_MODEL = process.env.MLX_WHISPER_MODEL
  ?? 'mlx-community/whisper-large-v3-turbo';
const MAX_DURATION_SEC = Number(process.env.WHISPER_MAX_DURATION_SEC ?? 1800);

export interface WhisperResult {
  status: 'ok' | 'skipped' | 'failed';
  text?: string;
  errorReason?: string;
  /** Wall-clock seconds the whole pipeline took. Useful for UI/cost tracking. */
  elapsedSec?: number;
  /** Source video duration in seconds, when known. */
  durationSec?: number;
}

function runFile(file: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = childProcess.execFile(
      file,
      args,
      { timeout: opts.timeoutMs, maxBuffer: 100 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { code?: string | number };
          // Distinguish "binary missing" from runtime failure.
          if (e.code === 'ENOENT') {
            reject(new Error(`binary not found: ${file}`));
            return;
          }
          // execFile resolves the callback with err for any non-zero exit;
          // we still want stderr for diagnostics.
          resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: typeof e.code === 'number' ? e.code : 1 });
          return;
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: 0 });
      },
    );
    proc.on('error', reject);
  });
}

/**
 * Probe a YouTube video's title via yt-dlp. Returns null if yt-dlp
 * can't reach the video (private / age-gated / region-locked) — caller
 * falls back to the videoId or transcript opening.
 */
export async function fetchYouTubeTitle(videoId: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  try {
    const { stdout, code } = await runFile(
      'yt-dlp',
      ['--no-warnings', '--get-title', `https://www.youtube.com/watch?v=${videoId}`],
      { timeoutMs: 15_000 },
    );
    if (code !== 0) return null;
    const title = stdout.trim();
    return title.length > 0 ? title : null;
  } catch {
    return null;
  }
}

/**
 * Probe a YouTube video's duration without downloading. Returns null if
 * yt-dlp can't even inspect it (private / age-gated / region-locked).
 */
async function probeDurationSec(videoUrl: string): Promise<number | null> {
  try {
    const { stdout, code } = await runFile(
      'yt-dlp',
      ['--no-warnings', '--get-duration', videoUrl],
      { timeoutMs: 30_000 },
    );
    if (code !== 0) return null;
    const raw = stdout.trim();
    // yt-dlp returns "HH:MM:SS", "MM:SS", or "SS"
    const parts = raw.split(':').map(Number);
    if (parts.some(Number.isNaN)) return null;
    let seconds = 0;
    for (const part of parts) seconds = seconds * 60 + part;
    return seconds;
  } catch {
    return null;
  }
}

/**
 * Download YouTube audio and transcribe via whisper.cpp.
 * `videoId` is the 11-char YouTube id; we build the canonical URL internally.
 */
export async function transcribeYouTubeAudio(videoId: string): Promise<WhisperResult> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return { status: 'skipped', errorReason: 'invalid video id' };
  }
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const started = Date.now();

  // Length probe first — avoids downloading a 2-hour video for nothing.
  const durationSec = await probeDurationSec(url);
  if (durationSec === null) {
    return { status: 'failed', errorReason: 'could not probe video duration (private, age-gated, or region-locked)' };
  }
  if (durationSec > MAX_DURATION_SEC) {
    return {
      status: 'skipped',
      durationSec,
      errorReason: `video is ${Math.round(durationSec / 60)} min; exceeds ${Math.round(MAX_DURATION_SEC / 60)}-min Whisper cap`,
    };
  }

  // Work in a tempdir so we don't leak audio files on crash.
  const workDir = await fs.mkdtemp(path.join(tmpdir(), `whisper-yt-${videoId}-`));
  const audioPath = path.join(workDir, 'audio.wav');

  try {
    // 1. Download + resample to 16kHz mono wav (whisper input format).
    const dl = await runFile(
      'yt-dlp',
      [
        '-q',
        '--no-warnings',
        '-x',
        '--audio-format', 'wav',
        '--postprocessor-args', 'ffmpeg:-ar 16000 -ac 1',
        '-o', path.join(workDir, 'audio.%(ext)s'),
        url,
      ],
      // 5 min cap on the download — short videos finish in seconds; if it
      // hangs longer, something is wrong (rate limit, geo block, etc.)
      { timeoutMs: 5 * 60_000 },
    );
    if (dl.code !== 0) {
      return {
        status: 'failed',
        durationSec,
        errorReason: `yt-dlp failed (exit ${dl.code}): ${dl.stderr.slice(0, 300)}`,
      };
    }

    // 2. Transcribe via mlx-whisper. Outputs <basename>.txt next to the
    // input file inside the work dir (audio.txt). On first run for a model,
    // mlx-whisper downloads it to ~/.cache/huggingface; subsequent calls
    // load instantly.
    const tx = await runFile(
      MLX_WHISPER,
      [
        audioPath,
        '--model', MLX_WHISPER_MODEL,
        '--output-format', 'txt',
        '--output-dir', workDir,
      ],
      // 15-min cap — first call may include a model download (~1.6GB);
      // steady-state, a 30-min audio transcribes in ~30s on M4 Max.
      { timeoutMs: 15 * 60_000 },
    );
    if (tx.code !== 0) {
      return {
        status: 'failed',
        durationSec,
        errorReason: `mlx_whisper failed (exit ${tx.code}): ${tx.stderr.slice(0, 300)}`,
      };
    }

    // 3. Read the .txt mlx-whisper wrote (basename matches the input).
    const text = (await fs.readFile(path.join(workDir, 'audio.txt'), 'utf8')).trim();
    if (!text) {
      return { status: 'failed', durationSec, errorReason: 'whisper produced empty transcript' };
    }

    return {
      status: 'ok',
      text,
      durationSec,
      elapsedSec: Math.round((Date.now() - started) / 1000),
    };
  } catch (e) {
    return {
      status: 'failed',
      durationSec,
      errorReason: e instanceof Error ? e.message : String(e),
    };
  } finally {
    // Always clean up the tempdir, even on failure.
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
