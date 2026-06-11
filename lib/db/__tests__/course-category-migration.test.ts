import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  COURSE_CLASSIFICATION_SEED,
  codesForCategory,
  codesBuildingToCareer,
  type CourseCategory,
} from '@/lib/db/course-category-seed';

const drizzleDir = join(process.cwd(), 'drizzle');
const migrationFile = readdirSync(drizzleDir).find((f) => f.startsWith('0033_') && f.endsWith('.sql'));
const sql = migrationFile ? readFileSync(join(drizzleDir, migrationFile), 'utf8') : '';

/** Pull the IN-list codes from the first UPDATE that sets the given category. */
function codesInCategoryUpdate(category: CourseCategory): string[] {
  const re = new RegExp(`SET "category" = '${category}' WHERE "code" IN \\(([^)]*)\\)`);
  const m = sql.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function codesInBuildsUpdate(): string[] {
  const m = sql.match(/SET "builds_to_career" = true WHERE "code" IN \(([^)]*)\)/);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('0033 migration backfill matches the seed map', () => {
  it('found the migration file', () => {
    expect(migrationFile, 'drizzle/0033_*.sql must exist').toBeTruthy();
  });

  it.each(['gc_core', 'specialty', 'major_req'] as CourseCategory[])(
    'category UPDATE for %s matches the seed exactly',
    (category) => {
      expect(codesInCategoryUpdate(category).sort()).toEqual(codesForCategory(category).sort());
    },
  );

  it('builds_to_career UPDATE matches the seed exactly', () => {
    expect(codesInBuildsUpdate().sort()).toEqual(codesBuildingToCareer().sort());
  });

  it('every seeded code appears in a category UPDATE', () => {
    const all = [
      ...codesInCategoryUpdate('gc_core'),
      ...codesInCategoryUpdate('specialty'),
      ...codesInCategoryUpdate('major_req'),
    ];
    expect(all.sort()).toEqual(Object.keys(COURSE_CLASSIFICATION_SEED).sort());
  });
});
