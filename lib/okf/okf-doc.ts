/**
 * Pure builder for an OKF-v0.1 markdown document from scratch. Distinct from
 * lib/ai/wiki/okf-frontmatter.ts:stampOkfFrontmatter (which MUTATES an existing
 * wiki page's frontmatter); this composes a fresh file. Used by the bundle
 * serializers (material / transcript / index). No I/O, no AI.
 */
export interface OkfDocFields {
  type: string;
  title: string;
  description: string;
  slug: string;
  tags: string[];
  timestamp: string; // ISO 8601
  resource: string;
  /** Optional scalar extras (e.g. { ignored: 'true' }) appended after the required keys. */
  extra?: Record<string, string>;
}

/** Quote a YAML scalar that may contain special chars; bare-word safe values pass through. */
function yamlScalar(v: string): string {
  return /^[\w./:@%-]+$/.test(v) ? v : JSON.stringify(v);
}

export function okfDocument(fields: OkfDocFields, body: string): string {
  const lines = [
    `type: ${fields.type}`,
    `title: ${yamlScalar(fields.title)}`,
    `description: ${yamlScalar(fields.description)}`,
    `slug: ${fields.slug}`,
    `tags: [${fields.tags.join(', ')}]`,
    `timestamp: ${fields.timestamp}`,
    `resource: ${fields.resource}`,
    ...Object.entries(fields.extra ?? {}).map(([k, v]) => `${k}: ${yamlScalar(v)}`),
  ];
  return `---\n${lines.join('\n')}\n---\n\n${body.trimEnd()}\n`;
}
