import { describe, it, expect } from 'vitest';
import {
  COURSE_CLASSIFICATION_SEED,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  codesForCategory,
  codesBuildingToCareer,
} from '@/lib/db/course-category-seed';

describe('COURSE_CLASSIFICATION_SEED', () => {
  it('classifies exactly 46 courses', () => {
    expect(Object.keys(COURSE_CLASSIFICATION_SEED)).toHaveLength(46);
  });

  it('partitions into 16 / 14 / 16 / 0 by category', () => {
    expect(codesForCategory('gc_core')).toHaveLength(16);
    expect(codesForCategory('specialty')).toHaveLength(14);
    expect(codesForCategory('major_req')).toHaveLength(16);
    expect(codesForCategory('other')).toHaveLength(0);
  });

  it('flags exactly 27 courses as building to career', () => {
    expect(codesBuildingToCareer()).toHaveLength(27);
  });

  it('flags every GC Core course true and every Specialty course false', () => {
    for (const c of codesForCategory('gc_core')) {
      expect(COURSE_CLASSIFICATION_SEED[c]!.buildsToCareer).toBe(true);
    }
    for (const c of codesForCategory('specialty')) {
      expect(COURSE_CLASSIFICATION_SEED[c]!.buildsToCareer).toBe(false);
    }
  });

  it('excludes the 5 unselected choose-one Major Req sides', () => {
    for (const c of ['STAT 2220', 'STAT 3090', 'STAT 3300', 'ECON 2000', 'PCID 3140']) {
      expect(COURSE_CLASSIFICATION_SEED[c]).toMatchObject({ category: 'major_req', buildsToCareer: false });
    }
  });

  it('includes the 11 named Major Req courses', () => {
    for (const c of ['ACCT 2010', 'ACCT 2020', 'MGT 2010', 'MKT 3010', 'PKSC 1020', 'STAT 2300', 'ENGL 1030', 'ENSP 2000', 'PSYC 2010', 'ECON 2110', 'PCID 3040']) {
      expect(COURSE_CLASSIFICATION_SEED[c]).toMatchObject({ category: 'major_req', buildsToCareer: true });
    }
  });

  it('orders categories with labels', () => {
    expect(CATEGORY_ORDER).toEqual(['gc_core', 'specialty', 'major_req', 'other']);
    expect(CATEGORY_LABELS.gc_core).toBe('GC Core');
  });
});
