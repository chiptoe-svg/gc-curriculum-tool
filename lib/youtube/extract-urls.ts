/**
 * Detect YouTube video URLs in arbitrary text and extract their video IDs.
 *
 * Handles the three patterns that show up in academic materials:
 *   - https://www.youtube.com/watch?v={ID}&...
 *   - https://youtu.be/{ID}
 *   - https://www.youtube.com/embed/{ID}
 *
 * Drops shorts and live URLs — they rarely have captions and aren't typical
 * for course content.
 */

const PATTERNS: RegExp[] = [
  /https?:\/\/(?:www\.)?youtube\.com\/watch\?[^"\s]*v=([a-zA-Z0-9_-]{11})/gi,
  /https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})/gi,
  /https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/gi,
];

export interface YouTubeReference {
  videoId: string;
  canonicalUrl: string;
}

export function extractYouTubeReferences(text: string): YouTubeReference[] {
  if (!text) return [];
  const seen = new Set<string>();
  const refs: YouTubeReference[] = [];
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const id = m[1];
      if (id && !seen.has(id)) {
        seen.add(id);
        refs.push({ videoId: id, canonicalUrl: `https://www.youtube.com/watch?v=${id}` });
      }
    }
  }
  return refs;
}
