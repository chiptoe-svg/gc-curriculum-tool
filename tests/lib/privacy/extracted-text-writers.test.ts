// @vitest-environment node
/**
 * Privacy-scrub spec 2026-10-05: updateExtractionResult is the ONLY writer of
 * course_materials.extracted_text, so no import path can skip the scrub.
 * Static scan of the source tree (lib, app, scripts). scripts/_one-off/ is
 * git-ignored local scratch and is not scanned (see STATE.md Deferred / debt).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['lib', 'app', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '__tests__', '.next']);
const QUERIES = 'lib/db/course-materials-queries.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || rel === path.join('scripts', '_one-off')) continue;
      out.push(...sourceFiles(rel));
    } else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) {
      out.push(rel);
    }
  }
  return out;
}

/** Start/end markers of a write to course_materials (Drizzle and raw SQL). */
const WRITE_WINDOWS: Array<[RegExp, RegExp]> = [
  [/\.update\(\s*courseMaterials\s*\)/g, /\.where\(/],
  [/\.insert\(\s*courseMaterials\s*\)/g, /\.returning\(|;/],
  [/UPDATE\s+"?course_materials"?/gi, /\bWHERE\b|;/i],
  [/INSERT\s+INTO\s+"?course_materials"?/gi, /;|`/],
];

/** Offsets of every write window that touches extracted text. */
function textWriteSites(src: string): number[] {
  const sites: number[] = [];
  for (const [start, end] of WRITE_WINDOWS) {
    for (const m of src.matchAll(start)) {
      const rest = src.slice(m.index! + m[0].length);
      const stop = rest.search(end);
      const window = rest.slice(0, stop < 0 ? 2000 : stop);
      if (/extractedText|extracted_text/.test(window)) sites.push(m.index!);
    }
  }
  return sites;
}

const files = SCAN_DIRS.flatMap(sourceFiles);

describe('extracted_text has exactly one writer', () => {
  it('no file other than course-materials-queries.ts writes extracted_text', () => {
    const offenders = files
      .filter(f => f !== QUERIES)
      .filter(f => textWriteSites(fs.readFileSync(path.join(ROOT, f), 'utf8')).length > 0);
    expect(offenders).toEqual([]);
  });

  it('inside course-materials-queries.ts, only updateExtractionResult writes it', () => {
    const src = fs.readFileSync(path.join(ROOT, QUERIES), 'utf8');
    const start = src.indexOf('export async function updateExtractionResult');
    const end = src.indexOf('\nexport ', start + 1);
    expect(start).toBeGreaterThan(-1);
    const sites = textWriteSites(src);
    expect(sites.length).toBe(2); // the success write and the scrub-failure write
    for (const s of sites) {
      expect(s).toBeGreaterThan(start);
      expect(s).toBeLessThan(end);
    }
  });

  it('insertMaterial cannot carry extracted text', () => {
    const src = fs.readFileSync(path.join(ROOT, QUERIES), 'utf8');
    const iface = /export interface InsertMaterialInput \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
    expect(iface).not.toBe('');
    expect(iface).not.toMatch(/extractedText/);
  });

  it('every caller of updateExtractionResult is known (new import paths must be reviewed)', () => {
    // Matches the import statement, not comments that mention the name.
    const IMPORTS_IT = /import\s*(?:type\s*)?\{[^}]*\bupdateExtractionResult\b[^}]*\}\s*from\s*['"]@\/lib\/db\/course-materials-queries['"]/;
    const callers = files
      .filter(f => f !== QUERIES)
      .filter(f => IMPORTS_IT.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
      .sort();
    expect(callers).toEqual([
      'app/api/courses/[code]/canvas-import/list-import.ts',
      'app/api/courses/[code]/canvas-import/route.ts',
      'app/api/courses/[code]/canvas-reextract/route.ts',
      'app/api/courses/[code]/imscc-import/route.ts',
      'app/api/courses/[code]/scan-linked-docs/route.ts',
      'lib/capture/finalize-extraction.ts',
      'scripts/reextract-canvas-files.ts',
    ]);
  });
});
