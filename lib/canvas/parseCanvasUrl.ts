export function parseCanvasUrl(url: string): string | null {
  const m = url.match(/\/courses\/(\d+)/);
  return m?.[1] ?? null;
}
