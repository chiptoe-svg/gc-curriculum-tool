import * as path from 'path';
import * as yauzl from 'yauzl';
import { XMLParser } from 'fast-xml-parser';
import { parseQtiAssessment } from '@/lib/canvas/parseQti';
import type {
  CanvasCourseData,
  CanvasAssignment,
  CanvasPage,
  CanvasModule,
  CanvasModuleItem,
  CanvasDiscussion,
} from '@/lib/canvas/fetchCanvasCourse';

// ─── Public types ────────────────────────────────────────────────────────────

export interface ImsccFile {
  name: string;
  bytes: Buffer;
  mimeType: string;
}

/** A web_resources file the parser deliberately did NOT extract, so the
 *  route can surface it to the user (e.g. "too large — upload separately"). */
export interface SkippedFile {
  name: string;
  /** 'too-large' = a readable type over the per-file cap (the "big stuff");
   *  'unsupported' = a type we can't read at all (image/video/audio/etc.). */
  reason: 'too-large' | 'unsupported';
  sizeBytes: number;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Coerce a value to a non-empty array, or return []. */
function toArray<T>(x: T | T[] | null | undefined): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Legacy MS Office — the route's extractor converts these via Docling
  // (isLegacyOfficeMime). They carry real content, so don't drop them.
  '.doc': 'application/msword',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.xls': 'application/vnd.ms-excel',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
};

const ALLOWED_EXTS = new Set(Object.keys(MIME_MAP));

/** Promisify yauzl.open and collect all central-directory entries into a Map. */
function openAndIndex(zipPath: string): Promise<{ zip: yauzl.ZipFile; entries: Map<string, yauzl.Entry> }> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) {
        // Surface a message that matches /zip|cartridge/i
        const msg = err?.message ?? 'unknown error';
        reject(new Error(`Cannot open as zip/cartridge: ${msg}`));
        return;
      }

      const entries = new Map<string, yauzl.Entry>();

      zip.on('entry', (entry: yauzl.Entry) => {
        entries.set(entry.fileName, entry);
        zip.readEntry();
      });

      zip.on('end', () => {
        resolve({ zip, entries });
      });

      zip.on('error', (e: Error) => {
        reject(new Error(`Zip read error: ${e.message}`));
      });

      zip.readEntry();
    });
  });
}

/** Read a single zip entry into a Buffer. */
function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(new Error(`Cannot read entry ${entry.fileName}: ${err?.message ?? 'no stream'}`));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

/** Extract an HTML/XML entry as a UTF-8 string. */
async function readEntryText(zip: yauzl.ZipFile, entries: Map<string, yauzl.Entry>, entryName: string): Promise<string | null> {
  const entry = entries.get(entryName);
  if (!entry) return null;
  const buf = await readEntry(zip, entry);
  return buf.toString('utf-8');
}

/** Extract the first H1 or H2 text from an HTML string, falling back to href basename. */
function extractTitle(html: string, fallback: string): string {
  // Try <h1> or <h2>
  const m = html.match(/<h[12][^>]*>(.*?)<\/h[12]>/is);
  if (m?.[1]) {
    // Strip any tags inside (e.g. <a>)
    return m[1].replace(/<[^>]+>/g, '').trim();
  }
  // Try <title>
  const t = html.match(/<title[^>]*>(.*?)<\/title>/is);
  if (t?.[1]) return t[1].replace(/<[^>]+>/g, '').trim();
  return fallback;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Parse an IMS Common Cartridge (.imscc) zip archive into CanvasCourseData
 * plus a list of binary file attachments.
 *
 * Memory-safe: opens with yauzl random-access mode and reads only the entries
 * that are actually needed — the entire archive is never inflated into memory.
 */
export async function parseImscc(
  zipPath: string,
  opts?: { maxFileBytes?: number },
): Promise<{ data: CanvasCourseData; files: ImsccFile[]; skipped: SkippedFile[] }> {
  const maxFileBytes = opts?.maxFileBytes ?? 25 * 1024 * 1024; // 25 MB default

  let zip: yauzl.ZipFile | undefined;
  try {
    const indexed = await openAndIndex(zipPath);
    zip = indexed.zip;
    const entries = indexed.entries;

    // ── Validate: must have imsmanifest.xml ────────────────────────────────
    if (!entries.has('imsmanifest.xml')) {
      throw new Error('No imsmanifest.xml — not a Common Cartridge');
    }

    // ── Parse manifest ─────────────────────────────────────────────────────
    const manifestXml = await readEntryText(zip, entries, 'imsmanifest.xml');
    if (!manifestXml) throw new Error('imsmanifest.xml is empty');

    const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const doc = xmlParser.parse(manifestXml) as Record<string, unknown>;
    const manifest = (doc['manifest'] ?? {}) as Record<string, unknown>;

    const courseId = (manifest['@_identifier'] as string | undefined) ?? 'imscc';

    // ── Course name from organization title ────────────────────────────────
    const organizations = (manifest['organizations'] ?? {}) as Record<string, unknown>;
    const organization = (organizations['organization'] ?? {}) as Record<string, unknown>;
    const orgTitle = (organization['title'] as string | undefined) ?? path.basename(zipPath);

    // ── Resources ──────────────────────────────────────────────────────────
    const resourcesNode = (manifest['resources'] ?? {}) as Record<string, unknown>;
    const rawResources = resourcesNode['resource'];
    const resources = toArray(rawResources) as Record<string, unknown>[];

    // ── Initialize accumulators ────────────────────────────────────────────
    let syllabusHtml = '';
    const pages: CanvasPage[] = [];
    const assignments: CanvasAssignment[] = [];
    const discussions: CanvasDiscussion[] = [];
    const files: ImsccFile[] = [];
    const skipped: SkippedFile[] = [];

    // quizzes collected in order
    const quizzes: ReturnType<typeof parseQtiAssessment>[] = [];

    // Process each resource
    for (const res of resources) {
      const identifier = String(res['@_identifier'] ?? '');
      const resType = String(res['@_type'] ?? '').toLowerCase();
      const href = String(res['@_href'] ?? '');

      // ── Syllabus ──────────────────────────────────────────────────────
      if (href === 'course_settings/syllabus.html') {
        const text = await readEntryText(zip, entries, href);
        if (text) syllabusHtml = text;
        continue;
      }

      // ── Wiki pages (webcontent under wiki_content/) ───────────────────
      if (resType === 'webcontent' && href.startsWith('wiki_content/')) {
        const text = await readEntryText(zip, entries, href);
        if (text) {
          const title = extractTitle(text, path.basename(href, path.extname(href)));
          pages.push({
            url: href,
            title,
            bodyHtml: text,
            published: true,
          });
        }
        continue;
      }

      // ── Assignments (learning-application-resource) ────────────────────
      if (resType.includes('learning-application-resource') || resType.includes('assignment')) {
        const text = await readEntryText(zip, entries, href);
        if (text) {
          const name = extractTitle(text, identifier);
          assignments.push({
            id: identifier,
            name,
            descriptionHtml: text,
            pointsPossible: null,
            rubric: [],
            rubricTitle: null,
            published: true,
          });
        }
        continue;
      }

      // ── Discussions (imsdt) ───────────────────────────────────────────
      if (resType.includes('imsdt')) {
        const text = await readEntryText(zip, entries, href);
        if (text) {
          const title = extractTitle(text, identifier);
          discussions.push({
            id: identifier,
            title,
            messageHtml: text,
            isAssignment: false,
            published: true,
          });
        }
        continue;
      }

      // ── Quizzes (imsqti) ──────────────────────────────────────────────
      if (resType.includes('imsqti')) {
        const text = await readEntryText(zip, entries, href);
        if (text) {
          quizzes.push(parseQtiAssessment(text, identifier));
        }
        continue;
      }

      // ── Web resources (files) ─────────────────────────────────────────
      if (href.startsWith('web_resources/')) {
        const ext = path.extname(href).toLowerCase();
        const entry = entries.get(href);
        if (!entry) continue;

        if (!ALLOWED_EXTS.has(ext)) {
          // A type we can't read (image/video/audio/etc.) — no capture value.
          console.log(`[parseImscc] skipped (unsupported type): ${href}`);
          skipped.push({ name: path.basename(href), reason: 'unsupported', sizeBytes: entry.uncompressedSize });
          continue;
        }

        if (entry.uncompressedSize > maxFileBytes) {
          // A readable type but over the per-file cap — the "big stuff" we
          // deliberately skip; surfaced so the user can upload it separately.
          console.log(`[parseImscc] skipped (over ${Math.round(maxFileBytes / 1024 / 1024)}MB cap): ${href} (${Math.round(entry.uncompressedSize / 1024 / 1024)}MB)`);
          skipped.push({ name: path.basename(href), reason: 'too-large', sizeBytes: entry.uncompressedSize });
          continue;
        }

        const bytes = await readEntry(zip, entry);
        const mimeType = MIME_MAP[ext] ?? 'application/octet-stream';
        files.push({
          name: path.basename(href),
          bytes,
          mimeType,
        });
        continue;
      }
    }

    // ── Modules from organizations tree ────────────────────────────────────
    const modules: CanvasModule[] = [];

    // organization.item is the root item; its children are the module items
    const rootItem = (organization['item'] ?? null) as Record<string, unknown> | null;
    if (rootItem) {
      const topLevelItems = toArray(rootItem['item']) as Record<string, unknown>[];
      for (const moduleItem of topLevelItems) {
        const moduleId = String(moduleItem['@_identifier'] ?? '');
        const moduleTitle = String((moduleItem['title'] as string | undefined) ?? moduleId);
        const childItems = toArray(moduleItem['item']) as Record<string, unknown>[];

        const items: CanvasModuleItem[] = childItems.map((child) => ({
          title: String((child['title'] as string | undefined) ?? ''),
          type: '',
          externalUrl: null,
          htmlUrl: null,
          published: true,
        }));

        modules.push({
          id: moduleId,
          name: moduleTitle,
          items,
          published: true,
        });
      }
    }

    const data: CanvasCourseData = {
      course: {
        id: courseId,
        name: orgTitle,
        syllabusHtml,
      },
      assignments,
      modules,
      pages,
      discussions,
      quizzes,
    };

    return { data, files, skipped };
  } finally {
    zip?.close();
  }
}
