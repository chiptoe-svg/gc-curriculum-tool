/**
 * Three-level hierarchical chunker used by the v2 ingestion pipeline.
 *
 * Output:
 *   - sections[]  — heading-aligned, or one synthetic section when no headings.
 *   - details[]   — ~500-token paragraphs nested under each section, with
 *                   100-token overlap to preserve cross-chunk context.
 *
 * Pure logic — no AI calls, no I/O. Deterministic across runs.
 */

import { createHash } from 'node:crypto';

const CHARS_PER_TOKEN = 4;
const DETAIL_TOKEN_TARGET = 500;
const DETAIL_OVERLAP_TOKENS = 100;
const SECTION_TOKEN_HARD_CAP = 2500;

export function approxTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface ChunkInput {
  fileName: string;
  text: string;
}

export interface SectionChunk {
  id: string;
  title: string;
  index: number;
  text: string;
}

export interface DetailChunk {
  id: string;
  parentSectionId: string;
  sectionTitle: string;
  sectionIndex: number;
  index: number;
  text: string;
}

export interface ChunkResult {
  sections: SectionChunk[];
  details: DetailChunk[];
}

const HEADING_RE = /^#{1,6}\s+(.+)$/;

function makeId(
  fileName: string,
  kind: string,
  position: number,
  sample: string,
): string {
  const h = createHash('sha256');
  h.update(fileName);
  h.update('|');
  h.update(kind);
  h.update('|');
  h.update(String(position));
  h.update('|');
  h.update(sample.slice(0, 80));
  return h.digest('hex').slice(0, 16);
}

function splitByHeadings(text: string): Array<{ title: string; body: string }> {
  const lines = text.split('\n');
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { title: m[1]!.trim(), body: [] };
    } else {
      if (!current) current = { title: '', body: [] };
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections.map(s => ({ title: s.title, body: s.body.join('\n').trim() }));
}

/**
 * Split a single oversized paragraph (no double-newlines) by word boundary.
 * Returns chunks of ~targetChars with overlapChars leading context.
 */
function splitLargeParagraph(text: string, targetChars: number, overlapChars: number): string[] {
  const words = text.split(' ');
  const chunks: string[] = [];
  let buf = '';
  for (const word of words) {
    const candidate = buf.length === 0 ? word : buf + ' ' + word;
    if (candidate.length > targetChars && buf.length > 0) {
      chunks.push(buf);
      // Carry overlap from the tail of the previous chunk
      const tail = buf.slice(-overlapChars);
      buf = tail + ' ' + word;
    } else {
      buf = candidate;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

function splitIntoDetailChunks(body: string): string[] {
  const targetChars = DETAIL_TOKEN_TARGET * CHARS_PER_TOKEN;
  const overlapChars = DETAIL_OVERLAP_TOKENS * CHARS_PER_TOKEN;
  if (body.length <= targetChars) return body ? [body] : [];

  const paragraphs = body.split(/\n{2,}/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let buf = '';

  for (const p of paragraphs) {
    // If a single paragraph is itself larger than the target, split it by words
    if (p.length > targetChars) {
      if (buf.length > 0) {
        chunks.push(buf);
        buf = '';
      }
      const subChunks = splitLargeParagraph(p, targetChars, overlapChars);
      chunks.push(...subChunks);
      continue;
    }

    if (buf.length + p.length + 2 > targetChars && buf.length > 0) {
      chunks.push(buf);
      buf = buf.slice(-overlapChars) + '\n\n' + p;
    } else {
      buf = buf.length === 0 ? p : buf + '\n\n' + p;
    }
  }
  if (buf.trim()) chunks.push(buf);
  return chunks;
}

export function chunkMaterial(input: ChunkInput): ChunkResult {
  const text = input.text.trim();
  if (!text) return { sections: [], details: [] };

  const rawSections = splitByHeadings(text);
  const sections: SectionChunk[] = [];
  const details: DetailChunk[] = [];

  rawSections.forEach((raw, sectionIndex) => {
    if (!raw.body && !raw.title) return;
    const sectionId = makeId(
      input.fileName,
      'section',
      sectionIndex,
      raw.body || raw.title,
    );
    const sectionText =
      raw.body.length > SECTION_TOKEN_HARD_CAP * CHARS_PER_TOKEN
        ? raw.body.slice(0, SECTION_TOKEN_HARD_CAP * CHARS_PER_TOKEN)
        : raw.body;
    sections.push({
      id: sectionId,
      title: raw.title,
      index: sectionIndex,
      text: sectionText,
    });

    const pieces = splitIntoDetailChunks(raw.body);
    pieces.forEach((piece, i) => {
      const detailId = makeId(
        input.fileName,
        'detail',
        sectionIndex * 1000 + i,
        piece,
      );
      details.push({
        id: detailId,
        parentSectionId: sectionId,
        sectionTitle: raw.title,
        sectionIndex,
        index: i,
        text: piece,
      });
    });
  });

  return { sections, details };
}
