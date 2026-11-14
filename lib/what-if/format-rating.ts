import type { Kud } from './types';

const DIMS = ['k', 'u', 'd'] as const;

/** "K3 U3 D2": the dimensions that carry a value (a foundational rating has Do only). */
export function kudText(k: Kud): string {
  return DIMS.filter(d => k[d] !== null).map(d => `${d.toUpperCase()}${k[d]}`).join(' ') || '–';
}

/** "D3 → D2" for each dimension that changed; null when nothing changed or there is no "before". */
export function changeText(before: Kud | null, after: Kud): string | null {
  if (!before) return null;
  const parts = DIMS
    .filter(d => before[d] !== after[d])
    .map(d => `${d.toUpperCase()}${before[d] ?? '–'} → ${d.toUpperCase()}${after[d] ?? '–'}`);
  return parts.length ? parts.join(', ') : null;
}

/** "Nov 10, 2026". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
