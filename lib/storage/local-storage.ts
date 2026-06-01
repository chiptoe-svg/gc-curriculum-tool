/**
 * Local-filesystem storage backend for course materials, replacing the
 * Vercel Blob calls used previously. Files live under
 * `~/.local/share/gc-curriculum-tool/materials/<courseSlug>/<file>` and
 * are served at runtime via `GET /api/storage/materials/<...>`.
 *
 * Used on the local Mac faculty deploy. The Vercel deploy doesn't upload
 * files (partner side has no upload UI), so there is no Vercel backend
 * needed any longer.
 *
 * Keys are validated against directory-traversal attempts before any
 * filesystem operation. The route reads with the same validation.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const STORAGE_ROOT = path.join(
  os.homedir(),
  '.local',
  'share',
  'gc-curriculum-tool',
  'materials',
);

export interface PutInput {
  /** Relative path under STORAGE_ROOT, e.g. 'gc-4440/1717182121-syllabus.pdf'. */
  key: string;
  bytes: Buffer;
}

export interface PutResult {
  /** Relative URL the app uses to read this file back. */
  url: string;
  /** Absolute filesystem path (for diagnostics, never returned to the client). */
  pathname: string;
  sizeBytes: number;
}

function assertSafeKey(key: string): void {
  if (!key || key.length === 0) throw new Error('storage key required');
  if (key.includes('..')) throw new Error('storage key contains "..": rejected');
  if (key.startsWith('/')) throw new Error('storage key must be relative');
  if (key.includes('\0')) throw new Error('storage key contains null byte');
}

/**
 * Slugify a course code for use as a path segment: 'GC 4440' → 'gc-4440'.
 * Only used internally by callers building a key; exported for symmetry.
 */
export function courseSlug(courseCode: string): string {
  return courseCode.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Sanitize a filename so it's safe as a path segment. Keeps alphanumerics,
 * dot, hyphen, underscore; replaces everything else with underscore. Never
 * empty (collapses to '_' if input was all bad chars).
 */
export function safeFilename(fileName: string): string {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : '_';
}

export async function putLocal(input: PutInput): Promise<PutResult> {
  assertSafeKey(input.key);
  const abs = path.join(STORAGE_ROOT, input.key);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, input.bytes);
  return {
    url: `/api/storage/materials/${input.key}`,
    pathname: abs,
    sizeBytes: input.bytes.length,
  };
}

export async function readLocal(key: string): Promise<Buffer | null> {
  assertSafeKey(key);
  const abs = path.join(STORAGE_ROOT, key);
  try {
    return await fs.readFile(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function deleteLocal(key: string): Promise<void> {
  assertSafeKey(key);
  const abs = path.join(STORAGE_ROOT, key);
  try {
    await fs.unlink(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * Best-effort: given a stored blobUrl, extract the key (relative path) if it
 * was created by the local backend. Returns null for foreign URLs (Vercel
 * Blob, Canvas, Google Docs).
 */
export function keyFromLocalUrl(blobUrl: string): string | null {
  const prefix = '/api/storage/materials/';
  if (!blobUrl.startsWith(prefix)) return null;
  return blobUrl.slice(prefix.length);
}
