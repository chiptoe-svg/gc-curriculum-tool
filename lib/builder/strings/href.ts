/** The cluster page that opens with these courses already on it. */
export function clusterStringHref(codes: string[]): string {
  const unique = [...new Set(codes)];
  return `/build/clusters/new?courses=${unique.map((c) => encodeURIComponent(c)).join(',')}`;
}
