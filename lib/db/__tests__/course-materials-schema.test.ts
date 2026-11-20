import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { courseMaterials, courseProfiles, courseProfileRuns } from '@/lib/db/schema';

describe('course_materials schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(courseMaterials);
    for (const c of [
      'id', 'courseCode', 'fileName', 'blobUrl', 'mimeType', 'sizeBytes',
      'pageCount', 'extractionMethod', 'extractionStatus', 'extractedText',
      'analysisFinding', 'analysisModel', 'analysisCostUsdCents',
      'uploadedAt', 'ipHash',
    ]) {
      expect(cols).toContain(c);
    }
  });
});

describe('course_profiles schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(courseProfiles);
    for (const c of [
      'courseCode', 'summary', 'learningObjectives', 'skills',
      'competencies', 'catalogDivergence', 'sourceRunId', 'manuallyEdited', 'updatedAt',
    ]) {
      expect(cols).toContain(c);
    }
  });
});

describe('course_profile_runs schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(courseProfileRuns);
    for (const c of [
      'id', 'courseCode', 'result', 'materialCount', 'model', 'costUsdCents', 'createdAt',
    ]) {
      expect(cols).toContain(c);
    }
  });
});

describe('migration 0075 text', () => {
  const sqlText = readFileSync('drizzle/0075_material_added_in_session.sql', 'utf8');
  it('is one transaction', () => {
    expect(sqlText.trim()).toMatch(/^(--[^\n]*\n)*BEGIN;/);
    expect(sqlText.trim().endsWith('COMMIT;')).toBe(true);
  });
  it('guards a second apply', () => {
    expect(sqlText).toContain("RAISE EXCEPTION '0075: already applied'");
    expect(sqlText).toMatch(/table_schema = 'public'[\s\S]*?added_in_session[\s\S]*?0075: already applied/);
  });
  it('only adds the column and changes no data', () => {
    const code = sqlText.replace(/^--.*$/gm, '').replace(/ON DELETE SET NULL/g, '');
    expect(code).not.toMatch(/\b(UPDATE|DELETE|DROP)\b/i);
    expect(sqlText).toContain('ADD COLUMN added_in_session uuid REFERENCES capture_sessions(session_id) ON DELETE SET NULL');
  });
});

describe('course_materials.added_in_session', () => {
  it('is declared with an FK to capture_sessions ON DELETE SET NULL', () => {
    const cfg = getTableConfig(courseMaterials);
    expect(cfg.columns.map((c) => c.name)).toContain('added_in_session');
    const fk = cfg.foreignKeys.map((f) => f.reference()).find((r) => r.columns.some((c) => c.name === 'added_in_session'));
    expect(fk?.foreignTable && getTableConfig(fk.foreignTable).name).toBe('capture_sessions');
    expect(fk?.foreignColumns.map((c) => c.name)).toEqual(['session_id']);
    const onDelete = cfg.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === 'added_in_session'))?.onDelete;
    expect(onDelete).toBe('set null');
  });
});
