import { okfDocument } from '@/lib/okf/okf-doc';

/** The fields of a captured material the bundle needs. A subset of CourseMaterialRow. */
export interface OkfMaterialInput {
  fileName: string;
  extractedText: string | null;
  ignored: boolean;
  mimeType: string;
  uploadedAt: Date | string;
}

/** Slugify a material file name for the OKF `slug` field. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'material';
}

/**
 * One captured material -> an OKF `type: material` markdown file. The body is
 * the canonical Docling-extracted text (not the AI digest). Pure.
 */
export function materialToOkfMarkdown(
  material: OkfMaterialInput,
  opts: { resource: string },
): string {
  const ts = (material.uploadedAt instanceof Date ? material.uploadedAt : new Date(material.uploadedAt)).toISOString();
  return okfDocument(
    {
      type: 'material',
      title: material.fileName,
      description: 'Captured course material (extracted text)',
      slug: slugify(material.fileName),
      tags: ['material'],
      timestamp: ts,
      resource: opts.resource,
      extra: {
        mime: material.mimeType,
        ...(material.ignored ? { ignored: 'true' } : {}),
      },
    },
    material.extractedText ?? '_(no extracted text)_',
  );
}
