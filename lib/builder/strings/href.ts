/** The cluster page that opens with these courses already on it; `query` is the caller's access query (`?slug=...`), kept. */
export function clusterStringHref(codes: string[], query = ''): string {
  const unique = [...new Set(codes)];
  const extra = query.replace(/^[?&]/, '');
  return `/build/clusters/new?courses=${unique.map((c) => encodeURIComponent(c)).join(',')}${extra ? `&${extra}` : ''}`;
}
