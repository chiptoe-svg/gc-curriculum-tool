import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '@/lib/db/schema';

const sqlText = readFileSync('drizzle/0071_skill_strings.sql', 'utf8');

describe('migration 0071 text', () => {
  it('is one transaction', () => {
    expect(sqlText.trim()).toMatch(/^(--[^\n]*\n)*BEGIN;/);
    expect(sqlText.trim().endsWith('COMMIT;')).toBe(true);
  });
  it('guards against a second apply and a missing 0070', () => {
    expect(sqlText).toContain("RAISE EXCEPTION '0071: already applied'");
    expect(sqlText).toMatch(/table_name = 'string_points'[\s\S]*?0071: already applied/);
    expect(sqlText).toContain("'0071: precondition — 0070 not applied'");
    expect(sqlText).toMatch(/table_name = 'curriculum_clusters'[\s\S]*?0071: precondition/);
  });
  it('changes no existing data', () => {
    expect(sqlText).not.toMatch(/^(DROP TABLE|DELETE|UPDATE|TRUNCATE)|DROP COLUMN/m);
  });
  it('creates exactly the seven tables', () => {
    const made = [...sqlText.matchAll(/^CREATE TABLE (\w+)/gm)].map((m) => m[1]).sort();
    expect(made).toEqual(['curriculum_string_events', 'curriculum_string_path', 'curriculum_strings', 'skill_orphan_notes', 'string_links', 'string_point_resolutions', 'string_points']);
  });
});

describe('drizzle tables', () => {
  const uniq = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).uniqueConstraints.map((u) => u.columns.map((c) => c.name));
  const pk = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).primaryKeys.map((p) => p.columns.map((c) => c.name));
  it('string_points and string_links unique columns', () => {
    expect(uniq(schema.stringPoints)).toEqual([['course_code', 'role', 'statement_hash']]);
    expect(uniq(schema.stringLinks)).toEqual([['from_point', 'to_point']]);
  });
  it('composite primary keys', () => {
    expect(pk(schema.curriculumStringPath)).toEqual([['string_id', 'position']]);
    expect(pk(schema.skillOrphanNotes)).toEqual([['course_code', 'role', 'statement_hash']]);
    expect(pk(schema.stringPointResolutions)).toEqual([['point_id', 'snapshot_id', 'model', 'prompt_version']]);
  });
  it('strings has the partial unique name index; events has the string/time index', () => {
    const idx = getTableConfig(schema.curriculumStrings).indexes.find((i) => i.config.name === 'idx_curriculum_strings_active_name');
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.where).toBeDefined();
    expect(getTableConfig(schema.curriculumStringEvents).indexes.map((i) => i.config.name)).toContain('idx_curriculum_string_events_string_at');
  });
});
