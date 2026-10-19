export type KudDescriptors = {
  knowDescriptor: string | null;
  understandDescriptor: string | null;
  doDescriptor: string;
};

/** True when K and U are both null (a foundational, D-only competency). */
export function isDoOnly(d: Pick<KudDescriptors, 'knowDescriptor' | 'understandDescriptor'>): boolean {
  return d.knowDescriptor == null && d.understandDescriptor == null;
}

/** Prompt/text lines for a competency's descriptors; null K/U are omitted and the competency is marked "Do only". Never emits "null"/"undefined". */
export function formatDescriptorLines(d: KudDescriptors): string[] {
  if (isDoOnly(d)) return [`Do only (foundational): ${d.doDescriptor}`];
  const lines: string[] = [];
  if (d.knowDescriptor != null) lines.push(`Know: ${d.knowDescriptor}`);
  if (d.understandDescriptor != null) lines.push(`Understand: ${d.understandDescriptor}`);
  lines.push(`Do: ${d.doDescriptor}`);
  return lines;
}
