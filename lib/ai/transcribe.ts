import OpenAI from 'openai';

/**
 * Audio transcription via OpenAI Whisper (`whisper-1`).
 *
 * Accepts the raw audio bytes plus the MIME type the browser reported.
 * Whisper accepts mp3, mp4, mpeg, mpga, m4a, wav, and webm — the browser
 * `MediaRecorder` API on Chrome typically produces `audio/webm;codecs=opus`,
 * which Whisper handles natively.
 *
 * Cost: ~$0.006 / minute. A typical 1–3 minute response costs a fraction of
 * a cent. No client-side caching needed.
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

export interface TranscribeOptions {
  /** Override the model. Default `whisper-1`. */
  model?: string;
  /** Optional ISO-639-1 language hint to improve accuracy (e.g. 'en'). */
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

export async function transcribeAudio(
  audio: Buffer | Uint8Array,
  mimeType: string,
  opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  if (!isSupportedAudioMime(mimeType)) {
    throw new Error(`Unsupported audio MIME type: ${mimeType}`);
  }

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
