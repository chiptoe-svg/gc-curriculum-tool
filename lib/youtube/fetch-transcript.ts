import { YoutubeTranscript } from 'youtube-transcript';

/**
 * Fetch the auto-caption transcript for a YouTube video via the publicly
 * available timed-text endpoint. Works for any video with captions enabled
 * (either auto-generated or owner-uploaded). No OAuth needed.
 *
 * The `youtube-transcript` npm package scrapes the same endpoint the
 * YouTube web player uses, so the same captions a viewer would see are what
 * we get back.
 */

export interface FetchedYouTubeTranscript {
  videoId: string;
  text: string;
  status: 'ok' | 'inaccessible';
  errorReason?: string;
  /**
   * Captions language detected from the returned text. 'en' when the
   * caption track looks English (≥85% ASCII chars in the first 500 chars),
   * 'other' when it doesn't (e.g. Arabic / CJK / Cyrillic — the library
   * silently returns whatever caption track exists, not necessarily
   * English). Callers should treat 'other' as "no usable captions" and
   * fall through to the Whisper audio path.
   */
  detectedLang?: 'en' | 'other';
}

interface RawTranscriptEntry {
  text?: string;
  offset?: number;
  duration?: number;
  lang?: string;
}

export async function fetchYouTubeTranscript(videoId: string): Promise<FetchedYouTubeTranscript> {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return { videoId, text: '', status: 'inaccessible', errorReason: 'invalid video id' };
  }
  let entries: RawTranscriptEntry[];
  try {
    entries = await YoutubeTranscript.fetchTranscript(videoId) as RawTranscriptEntry[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The library throws on private videos, age-restricted videos, and
    // videos without captions enabled — all "inaccessible" from our pov.
    return {
      videoId,
      text: '',
      status: 'inaccessible',
      errorReason: msg.length > 200 ? msg.slice(0, 200) + '…' : msg,
    };
  }
  if (!entries || entries.length === 0) {
    return { videoId, text: '', status: 'inaccessible', errorReason: 'no captions available' };
  }

  // The transcript is an array of timed entries. For the auditor's purposes,
  // we want flowing prose — concatenate the text segments with spaces and
  // collapse runs of whitespace.
  const joined = entries
    .map(e => (e.text ?? '').replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 0)
    .join(' ');
  const cleaned = joined.replace(/\s+/g, ' ').trim();

  if (cleaned.length === 0) {
    return { videoId, text: '', status: 'inaccessible', errorReason: 'empty transcript' };
  }

  // Cheap English-vs-other detector: ASCII-ratio over the first 500 chars.
  // English caption text is overwhelmingly ASCII (letters, digits, space,
  // punctuation). Arabic / CJK / Cyrillic / Devanagari etc. is mostly
  // non-ASCII. 85% threshold is generous — handles English text with the
  // occasional smart-quote or emoji.
  const sample = cleaned.slice(0, 500);
  let asciiCount = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) < 128) asciiCount++;
  }
  const asciiRatio = sample.length > 0 ? asciiCount / sample.length : 1;
  const detectedLang: 'en' | 'other' = asciiRatio >= 0.85 ? 'en' : 'other';

  return { videoId, text: cleaned, status: 'ok', detectedLang };
}
