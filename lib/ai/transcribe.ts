import OpenAI from 'openai';
import * as childProcess from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Audio transcription.
 *
 * Default backend: **local MLX-Whisper** (`mlx_whisper` CLI, M4 Max
 * Metal). Free, on-device, no network round-trip. Same engine the
 * YouTube path uses (lib/youtube/transcribe-audio.ts) — unified
 * 2026-06-03 so the mic path and the YouTube path share the same
 * Whisper model and produce comparable output.
 *
 * Fallback backend: **OpenAI Whisper API** (`whisper-1`). Used when
 * env `WHISPER_BACKEND=openai` is set OR when the local mlx_whisper
 * binary is missing. Costs ~$0.006/min.
 *
 * Accepts the raw audio bytes plus the MIME type the browser reported.
 * Both backends accept mp3, mp4, m4a, wav, webm, ogg. The browser
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

  // Local MLX-Whisper is the default. Fall back to OpenAI when:
  //  - Env forces it (`WHISPER_BACKEND=openai`)
  //  - The mlx_whisper binary is missing (we let runFile error bubble)
  const wantOpenAI = process.env.WHISPER_BACKEND === 'openai';
  if (wantOpenAI) return transcribeAudioOpenAI(audio, mimeType, opts);

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
