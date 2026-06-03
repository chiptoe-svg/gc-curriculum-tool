import OpenAI from 'openai';
import * as childProcess from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Audio transcription.
 *
 * Backend ladder (first one to return a transcript wins):
 *
 *   1. **omlx persistent MLX server** — opportunistic, gated by a
 *      pre-flight against `/api/status`. Only used when omlx is up,
 *      idle (no in-flight or queued STT requests), and the configured
 *      Whisper model is loaded. ~3× faster than the CLI because the
 *      model stays resident across calls. Skipped silently when not
 *      configured or when the pre-flight says "busy" — the audit-time
 *      use case can't tolerate queueing behind a 3-minute YouTube
 *      transcribe. See lib/youtube/transcribe-audio.ts for the YouTube
 *      path that always tries omlx (different priority calculus).
 *
 *   2. **local MLX-Whisper CLI** (`mlx_whisper` binary, M4 Max Metal).
 *      Free, on-device, no contention with omlx. Pays ~0.8s of Python
 *      startup + MLX runtime init per call, which is the cost of total
 *      isolation. Always tried before OpenAI when the binary exists.
 *
 *   3. **OpenAI Whisper API** (`whisper-1`). Last resort: only when
 *      env `WHISPER_BACKEND=openai` is set OR when the CLI binary is
 *      missing (e.g., dev machine without mlx-whisper). Costs ~$0.006/min.
 *
 * Accepts the raw audio bytes plus the MIME type the browser reported.
 * All backends accept mp3, mp4, m4a, wav, webm, ogg. The browser
 * MediaRecorder API on Chrome produces audio/webm;codecs=opus; Safari
 * produces audio/mp4. Both work.
 */

const SUPPORTED_MIME_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
];

const MLX_WHISPER = process.env.MLX_WHISPER_PATH
  ?? path.join(process.env.HOME ?? '/Users/admin', '.local/bin/mlx_whisper');
const MLX_WHISPER_MODEL = process.env.MLX_WHISPER_MODEL
  ?? 'mlx-community/whisper-large-v3-turbo';

const OMLX_BASE_URL = process.env.LOCAL_BASE_URL?.trim() ?? '';
const OMLX_API_KEY = process.env.LOCAL_API_KEY?.trim() ?? '';
const OMLX_WHISPER_MODEL = process.env.WHISPER_OMLX_MODEL?.trim() ?? '';
// Pre-flight cap. 100ms is plenty for a localhost JSON ping; anything
// slower means omlx is sluggish and we'd rather just go to CLI.
const OMLX_PREFLIGHT_TIMEOUT_MS = 100;

export interface TranscribeOptions {
  /** Override the model. Default 'mlx-large-v3-turbo' or 'whisper-1' depending on backend. */
  model?: string;
  /** Optional ISO-639-1 language hint to improve accuracy (e.g. 'en'). Currently only forwarded to the OpenAI backend. */
  language?: string;
}

export interface TranscribeResult {
  text: string;
  model: string;
}

function fileNameForMime(mime: string): string {
  if (mime.startsWith('audio/webm')) return 'audio.webm';
  if (mime.startsWith('audio/mp4') || mime.startsWith('audio/m4a')) return 'audio.m4a';
  if (mime.startsWith('audio/mpeg') || mime.startsWith('audio/mp3')) return 'audio.mp3';
  if (mime.startsWith('audio/wav')) return 'audio.wav';
  if (mime.startsWith('audio/ogg')) return 'audio.ogg';
  return 'audio.bin';
}

export function isSupportedAudioMime(mime: string): boolean {
  const lowered = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  return SUPPORTED_MIME_TYPES.some(prefix => lowered === prefix || lowered.startsWith(prefix));
}

function runFile(
  file: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      file,
      args,
      { timeout: opts.timeoutMs, maxBuffer: 100 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { code?: string | number };
          if (e.code === 'ENOENT') {
            reject(new Error(`binary not found: ${file}`));
            return;
          }
          resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: typeof e.code === 'number' ? e.code : 1 });
          return;
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: 0 });
      },
    );
  });
}

/**
 * Pre-flight: returns true iff omlx is reachable within 100ms, has no
 * STT requests in flight or queued, and has the configured Whisper
 * model loaded. False on any failure (env unset, network error, timeout,
 * non-200, model not loaded, busy). Never throws — callers treat false
 * as "skip omlx, use CLI."
 *
 * omlx is strict FIFO per engine pool (no priority queueing — confirmed
 * by inspecting the OpenAPI surface), so this gate is the only way to
 * keep mic out of YouTube's queue. The gate is directional (a YouTube
 * request could land between our check and our POST), so worst case is
 * one transcribe ahead of us — not catastrophic.
 */
async function omlxIdleAndReady(): Promise<boolean> {
  if (!OMLX_BASE_URL || !OMLX_API_KEY || !OMLX_WHISPER_MODEL) return false;
  try {
    // LOCAL_BASE_URL is the /v1 root (e.g. http://localhost:8000/v1).
    // /api/status sits at the server root, not under /v1, so strip /v1.
    const statusUrl = OMLX_BASE_URL.replace(/\/v1\/?$/, '') + '/api/status';
    const res = await fetch(statusUrl, {
      headers: { authorization: `Bearer ${OMLX_API_KEY}` },
      signal: AbortSignal.timeout(OMLX_PREFLIGHT_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const status = await res.json() as {
      active_requests?: number;
      waiting_requests?: number;
      loaded_models?: string[];
    };
    const idle = (status.active_requests ?? 0) === 0 && (status.waiting_requests ?? 0) === 0;
    const modelReady = (status.loaded_models ?? []).includes(OMLX_WHISPER_MODEL);
    return idle && modelReady;
  } catch {
    return false;
  }
}

async function transcribeAudioOmlx(
  audio: Buffer | Uint8Array,
  mimeType: string,
): Promise<TranscribeResult> {
  const fileName = fileNameForMime(mimeType);
  const blob = new Blob([new Uint8Array(audio)], { type: mimeType });
  const form = new FormData();
  form.append('file', blob, fileName);
  form.append('model', OMLX_WHISPER_MODEL);

  const url = OMLX_BASE_URL.replace(/\/$/, '') + '/audio/transcriptions';
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${OMLX_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`omlx returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json() as { text?: string };
  if (!json.text) throw new Error('omlx returned no text');
  return { text: json.text.trim(), model: `omlx:${OMLX_WHISPER_MODEL}` };
}

async function transcribeAudioMlx(
  audio: Buffer | Uint8Array,
  mimeType: string,
): Promise<TranscribeResult> {
  // mlx_whisper wants a file on disk. Write to a tempdir, transcribe,
  // clean up. Tempdir is removed even on failure so we don't leak audio.
  const workDir = await fs.mkdtemp(path.join(tmpdir(), 'mic-mlx-'));
  const fileName = fileNameForMime(mimeType);
  const audioPath = path.join(workDir, fileName);
  const stem = fileName.replace(/\.[^.]+$/, '');
  try {
    await fs.writeFile(audioPath, audio);
    const tx = await runFile(
      MLX_WHISPER,
      [audioPath, '--model', MLX_WHISPER_MODEL, '--output-format', 'txt', '--output-dir', workDir],
      // 5-min cap. Mic clips are seconds; the cap exists so a hung
      // model load doesn't pin the request handler forever.
      { timeoutMs: 5 * 60_000 },
    );
    if (tx.code !== 0) {
      throw new Error(`mlx_whisper failed (exit ${tx.code}): ${tx.stderr.slice(0, 300)}`);
    }
    const text = (await fs.readFile(path.join(workDir, `${stem}.txt`), 'utf8')).trim();
    return { text, model: `mlx:${MLX_WHISPER_MODEL}` };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function transcribeAudioOpenAI(
  audio: Buffer | Uint8Array,
  mimeType: string,
  opts: TranscribeOptions,
): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const client = new OpenAI({ apiKey });
  const model = opts.model ?? 'whisper-1';

  // OpenAI's Node SDK wants a File-like object. We construct one from the
  // raw bytes; the filename matters for Whisper's format detection.
  const fileName = fileNameForMime(mimeType);
  const blob = new Blob([new Uint8Array(audio)], { type: mimeType });
  const file = new File([blob], fileName, { type: mimeType });

  const response = await client.audio.transcriptions.create({
    file,
    model,
    ...(opts.language ? { language: opts.language } : {}),
  });

  return { text: response.text, model };
}

export async function transcribeAudio(
  audio: Buffer | Uint8Array,
  mimeType: string,
  opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
  if (!isSupportedAudioMime(mimeType)) {
    throw new Error(`Unsupported audio MIME type: ${mimeType}`);
  }

  // WHISPER_BACKEND=openai forces the OpenAI hop, skipping the local
  // ladder entirely. Used for dev parity-checks or as an emergency lever.
  if (process.env.WHISPER_BACKEND === 'openai') {
    return transcribeAudioOpenAI(audio, mimeType, opts);
  }

  // Opportunistic omlx. Pre-flight gates against the case where omlx
  // is mid-YouTube-transcribe — we'd rather pay 0.8s of CLI startup
  // than queue behind a multi-second STT call.
  if (await omlxIdleAndReady()) {
    try {
      return await transcribeAudioOmlx(audio, mimeType);
    } catch (e) {
      // Fall through to CLI. Log so a recurring omlx failure doesn't
      // hide silently — but a single failure on a transient blip is
      // fine to absorb.
      console.warn(`[transcribe] omlx attempt failed, falling back to CLI:`, e instanceof Error ? e.message : e);
    }
  }

  try {
    return await transcribeAudioMlx(audio, mimeType);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Binary-missing → fall back to OpenAI so the feature degrades gracefully
    // (e.g., on a dev machine without mlx-whisper installed).
    if (msg.startsWith('binary not found:')) {
      console.warn(`[transcribe] ${msg} — falling back to OpenAI Whisper API`);
      return transcribeAudioOpenAI(audio, mimeType, opts);
    }
    throw e;
  }
}
