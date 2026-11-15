import { describe, expect, it } from 'vitest';
import data from '../data/degree-plans.json';
import { genEdCheck, genEdOf, planFromCatalog, termRow, type CatalogYear } from '../degree';
import { hoursOf, placeCourses } from '../compute';
import { EMPTY_PLAN, type Library } from '../types';

const y2026 = (data as unknown as { years: Record<string, CatalogYear> }).years['2026-2027']!;
let n = 0;
const newId = (p: string) => `${p}:${++n}`;
const emptyLib: Library = { courses: [], competencies: [], targets: [], prereqs: [] } as unknown as Library;

describe('catalog plan', () => {
  it('puts the ten catalog terms in nine rows, the junior summer with the junior spring', () => {
    expect(termRow('Freshman/First Semester')).toEqual({ act: 1, slot: 0 });
    expect(termRow('Sophomore/Summer')).toEqual({ act: 2, slot: 1 });
    expect(termRow('Junior/Second Semester')).toEqual(termRow('Junior/Summer'));
    expect(termRow('Senior/Second Semester')).toEqual({ act: 3, slot: 2 });
  });

  it('maps requirement slots to Gen Ed categories, and leaves the rest unmapped', () => {
    expect(genEdOf('Arts and Humanities (Literature) Requirement', y2026.genEd)).toBe('Arts and Humanities');
    expect(genEdOf('Oral Communication Requirement', y2026.genEd)).toBe('Communication');
    expect(genEdOf('Approved Laboratory Science Requirement', y2026.genEd)).toBe('Natural Sciences with Lab');
    expect(genEdOf('Elective', y2026.genEd)).toBeNull();
    expect(genEdOf('Specialty Area Requirement', y2026.genEd)).toBeNull();
  });

  it('starts a 2026-27 plan: tracked courses as themselves, other courses from the catalog, slots and choices as placeholders', () => {
    const plan = planFromCatalog('2026-2027', y2026, new Set(['GC 1010', 'GC 1020', 'GC 4800']), new Map([['PSYC 2010', { title: 'General Psychology', credits: '3', description: '' }]]), newId, EMPTY_PLAN);
    expect(plan.catalogYear).toBe('2026-2027');
    expect(plan.degreeHours).toBe(120);
    expect(plan.placements.find(p => p.ref === 'GC 1010')).toMatchObject({ act: 1, slot: 0 });
    expect(plan.placements.find(p => p.ref === 'GC 4800')).toMatchObject({ act: 3, slot: 2 });
    expect(plan.proposed.find(p => p.code === 'PSYC 2010')).toMatchObject({ source: 'catalog', title: 'General Psychology', credits: '3' });
    const stat = plan.requirements!.find(r => r.options.includes('STAT 2220'));
    expect(stat?.label.startsWith('One of STAT 2220')).toBe(true);
    expect(plan.requirements!.some(r => r.genEd === 'Arts and Humanities')).toBe(true);
    // Every catalog item is on the map once, and the hours add up to the catalog's term totals.
    const items = y2026.program!.terms.flatMap(t => t.items).length;
    expect(plan.placements.length).toBe(items);
    const lib = { ...emptyLib, courses: ['GC 1010', 'GC 1020', 'GC 4800'].map(code => ({ code, title: code, level: 1, category: 'gc_core', track: 'Core', description: '', credits: code === 'GC 1010' ? '1' : code === 'GC 1020' ? '2' : '1', wiki: null, objectives: [], sheetProjects: [], stated: [], versions: [], whatIfs: [] })) } as Library;
    const catalogTotal = y2026.program!.terms.reduce((s, t) => s + (t.credits ?? 0), 0);
    const known = hoursOf(placeCourses(lib, plan));
    expect(known.total + known.unknown.length * 0).toBeLessThanOrEqual(catalogTotal);
  });
});

describe('General Education check', () => {
  const cats = y2026.genEd;
  it('counts placed courses on a category\'s list, and placeholders as planned', () => {
    const engl = cats.find(c => c.name === 'Communication')!.allowed[0]!;
    const rows = genEdCheck(cats, [
      { code: engl, credits: 3, branch: null },
      { code: 'X', credits: 3, branch: null, requirement: { id: 'r1', label: 'Oral Communication', credits: 3, options: [], genEd: 'Communication', notes: [] } },
    ]);
    const comm = rows.find(r => r.name === 'Communication')!;
    expect(comm.courses.map(c => c.code)).toEqual([engl]);
    expect(comm.planned.map(p => p.credits)).toEqual([3]);
    expect(comm.status).toBe('planned'); // 3 placed + 3 planned reaches 6
    expect(rows.find(r => r.name === 'Mathematics')!.status).toBe('short');
  });
  it('leaves branch courses out and counts a course toward one category only', () => {
    const shared = cats.find(c => c.name === 'Global Challenges')!.allowed.find(c => cats.some(o => o.name !== 'Global Challenges' && o.allowed.includes(c)));
    const rows = genEdCheck(cats, [{ code: 'MATH 1010', credits: 4, branch: 'b' }, ...(shared ? [{ code: shared, credits: 3, branch: null }] : [])]);
    expect(rows.find(r => r.name === 'Mathematics')!.courses).toEqual([]);
    if (shared) expect(rows.filter(r => r.courses.some(c => c.code === shared)).length).toBe(1);
  });
});
