import { describe, it, expect } from 'vitest';
import { buildIndexableMaterialsWhere, __mapMaterialRowForTest, isSyllabusInsert } from '@/lib/db/course-materials-queries';

/**
 * Recursively collect string tokens from a drizzle SQL condition's queryChunks
 * tree. Drizzle stores column references as objects with a `.name` property
 * (e.g. PgTimestamp, PgText) rather than inlining the column name into a
 * string chunk. This helper walks the tree and gathers both `.name` values and
 * `.value[]` string arrays, which together surface all column names and
 * SQL keywords in the predicate.
 *
 * The `seen` set prevents circular-reference loops (drizzle columns back-
 * reference their table, which references the column again).
 */
function collectSQLTokens(
  node: unknown,
  seen = new Set<unknown>(),
  acc: string[] = [],
): string[] {
  if (!node || typeof node !== 'object' || seen.has(node)) return acc;
  seen.add(node);

  const n = node as Record<string, unknown>;

  if (typeof n['name'] === 'string' && n['name']) {
    acc.push(n['name'] as string);
  }
  if (Array.isArray(n['value'])) {
    for (const v of n['value'] as unknown[]) {
      if (typeof v === 'string') acc.push(v);
    }
  }
  if (Array.isArray(n['queryChunks'])) {
    for (const chunk of n['queryChunks'] as unknown[]) {
      collectSQLTokens(chunk, seen, acc);
    }
  }
  return acc;
}

describe('buildIndexableMaterialsWhere', () => {
  it('filters to ready, not-ignored, not-retired (references all three currency columns)', () => {
    const condition = buildIndexableMaterialsWhere('GC 3460');
    const tokens = collectSQLTokens(condition);
    const text = tokens.join(' ');

    // All three column names that define the cross-course spine currency contract
    expect(tokens).toContain('indexing_status');
    expect(tokens).toContain('ignored');
    expect(tokens).toContain('retired_at');

    // Sanity: the IS NULL clause for retired_at is present
    expect(text).toMatch(/is null/i);
  });

  it('scopes the predicate to the given course code', () => {
    const condition = buildIndexableMaterialsWhere('GC 3460');
    const tokens = collectSQLTokens(condition);
    // course_code column should be referenced
    expect(tokens).toContain('course_code');
  });
});

describe('mapMaterialRow', () => {
  it('maps ingest_provider (incl. null)', () => {
    const base = {
      id: 'a', course_code: 'GC 1010', file_name: 'f', blob_url: 'u', mime_type: 'application/pdf',
      size_bytes: 1, page_count: null, extraction_method: null, extraction_status: 'pending',
      extracted_text: null, analysis_finding: null, analysis_model: null, analysis_cost_usd_cents: null,
      uploaded_at: new Date(), ip_hash: 'h', digest: null, digest_model: null, digest_generated_at: null,
      use_digest: false, ferpa_risk: 'low', auto_set_aside: false, set_aside_reason: null,
      indexing_status: 'queued', tier: null, indexed_at: null, ignored: false, ignored_items: null,
      source_code: null, raw_cleared: false, retired_at: null,
    };
    expect(__mapMaterialRowForTest({ ...base, ingest_provider: 'local' }).ingestProvider).toBe('local');
    expect(__mapMaterialRowForTest({ ...base, ingest_provider: null }).ingestProvider).toBeNull();
  });
});

describe('mapMaterialRow — is_syllabus', () => {
  const base = {
    id: 'a', course_code: 'GC 1010', file_name: 'f', blob_url: 'u', mime_type: 'application/pdf',
    size_bytes: 1, page_count: null, extraction_method: null, extraction_status: 'pending',
    extracted_text: null, analysis_finding: null, analysis_model: null, analysis_cost_usd_cents: null,
    uploaded_at: new Date(), ip_hash: 'h', digest: null, digest_model: null, digest_generated_at: null,
    use_digest: false, ferpa_risk: 'low', auto_set_aside: false, set_aside_reason: null,
    indexing_status: 'queued', tier: null, indexed_at: null, ignored: false, ignored_items: null,
    source_code: null, raw_cleared: false, retired_at: null, ingest_provider: null,
  };
  it('maps is_syllabus, defaulting a missing value to false', () => {
    expect(__mapMaterialRowForTest({ ...base, is_syllabus: true }).isSyllabus).toBe(true);
    expect(__mapMaterialRowForTest({ ...base, is_syllabus: false }).isSyllabus).toBe(false);
    expect(__mapMaterialRowForTest(base).isSyllabus).toBe(false);
  });
});

describe('isSyllabusInsert', () => {
  it('flags the Canvas syllabus page by default', () => {
    expect(isSyllabusInsert({ fileName: 'Canvas: Syllabus' })).toBe(true);
    expect(isSyllabusInsert({ fileName: 'Canvas: Assignments' })).toBe(false);
    expect(isSyllabusInsert({ fileName: 'my syllabus.pdf' })).toBe(false);
  });
  it('an explicit flag wins', () => {
    expect(isSyllabusInsert({ fileName: 'notes.pdf', isSyllabus: true })).toBe(true);
    expect(isSyllabusInsert({ fileName: 'Canvas: Syllabus', isSyllabus: false })).toBe(false);
  });
});
