import { CATEGORY_ORDER, type CourseCategory } from '@/lib/db/course-category-seed';

/**
 * Group rows by `category` in the fixed CATEGORY_ORDER, sorting each group's
 * rows by `code`. Empty categories are omitted (so "Other courses" is hidden
 * until a course lands there).
 */
export function groupByCategory<T extends { category: CourseCategory; code: string }>(
  rows: T[],
): Array<{ category: CourseCategory; rows: T[] }> {
  const byCat = new Map<CourseCategory, T[]>();
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push(r);
  }
  return CATEGORY_ORDER.filter((c) => (byCat.get(c)?.length ?? 0) > 0).map((category) => ({
    category,
    rows: byCat.get(category)!.slice().sort((a, b) => a.code.localeCompare(b.code)),
  }));
}
