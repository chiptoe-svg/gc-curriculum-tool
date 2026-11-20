import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '@/lib/db/schema';

const sqlText = readFileSync('drizzle/0074_skill_tree.sql', 'utf8');

describe('migration 0074 text', () => {
  it('is one transaction', () => {
    expect(sqlText.trim()).toMatch(/^(--[^\n]*\n)*BEGIN;/);
    expect(sqlText.trim().endsWith('COMMIT;')).toBe(true);
  });
  it('guards against a second apply and a missing 0073', () => {
    expect(sqlText).toContain("RAISE EXCEPTION '0074: already applied'");
    expect(sqlText).toMatch(/table_name = 'skill_nodes'[\s\S]*?0074: already applied/);
    expect(sqlText).toContain("'0074: precondition — 0073 not applied'");
    expect(sqlText).toMatch(/table_name = 'app_settings'[\s\S]*?0074: precondition/);
  });
  it('deletes and drops nothing', () => {
    expect(sqlText).not.toMatch(/^(DROP TABLE|DELETE|TRUNCATE)|DROP COLUMN/m);
  });
  it('creates exactly the four tables', () => {
    const made = [...sqlText.matchAll(/^CREATE TABLE (\w+)/gm)].map((m) => m[1]).sort();
    expect(made).toEqual(['node_depths', 'skill_leaves', 'skill_nodes', 'skill_tree_events']);
  });
  it('adds the node and need columns to string_points', () => {
    const alter = sqlText.match(/ALTER TABLE string_points[\s\S]*?;/)?.[0] ?? '';
    for (const c of ['node_id', 'need_k', 'need_u', 'need_d']) expect(alter).toContain(`ADD COLUMN ${c} `);
  });
});

describe('drizzle tables', () => {
  const pk = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).primaryKeys.map((p) => p.columns.map((c) => c.name));
  it('composite primary keys', () => {
    expect(pk(schema.skillLeaves)).toEqual([['course_code', 'skill_ref', 'node_id']]);
    expect(pk(schema.nodeDepths)).toEqual([['node_id', 'course_code', 'instructor']]);
  });
  it('exports the events table and the new string_points columns', () => {
    expect(getTableConfig(schema.skillTreeEvents).name).toBe('skill_tree_events');
    expect(getTableConfig(schema.skillNodes).name).toBe('skill_nodes');
    const cols = getTableConfig(schema.stringPoints).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['node_id', 'need_k', 'need_u', 'need_d']));
  });
});
