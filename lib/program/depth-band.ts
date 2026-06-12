/**
 * Depth bands for program-level display (A7, 2026-06-12 vision-alignment
 * review). The 0–5 depth instrument has no published reliability data yet
 * (the A6 study is queued), so program-level surfaces default to rendering
 * BANDS — the resolution the instrument is known to support — with exact
 * integers behind a click/tooltip. Banding is display-only: nothing stored
 * changes, and the cell drawer still shows the precise scores + rationale.
 *
 *   0   → none    '—'
 *   1–2 → low     'L'
 *   3   → working 'W'
 *   4–5 → high    'H'
 *
 * Null passes through as null: no-data is not a band (mirrors the repo-wide
 * null-discipline — never collapse missing to zero).
 */

export interface DepthBand {
  key: 'none' | 'low' | 'working' | 'high';
  /** One-character cell glyph. */
  short: string;
  /** Legend / tooltip wording. */
  word: string;
}

export function depthBand(n: number | null): DepthBand | null {
  if (n === null) return null;
  if (n <= 0) return { key: 'none', short: '—', word: 'not present' };
  if (n <= 2) return { key: 'low', short: 'L', word: 'low (1–2)' };
  if (n === 3) return { key: 'working', short: 'W', word: 'working (3)' };
  return { key: 'high', short: 'H', word: 'high (4–5)' };
}
