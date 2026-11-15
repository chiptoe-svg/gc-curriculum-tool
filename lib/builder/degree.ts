// A plan started from a catalog year's recommended Graphic Communications plan, and the General Education
// check. The data comes from lib/builder/data/degree-plans.json (scripts/catalog/export-degree-plans.ts).
//
// The catalog plan has ten terms (eight semesters, a sophomore summer and a junior summer); the map has nine
// term rows. The junior summer (internship and co-op) shares the junior spring row (owner default, 2026-11-15).
import { COL_W } from './layout';
import type { Act, Placement, PlanState, ProposedCourse, Requirement, Slot } from './types';

export interface CatalogItem { kind: 'course' | 'choice' | 'slot'; code: string | null; options: string[]; label: string | null; credits: number | null; notes: string[] }
export interface CatalogTerm { label: string; credits: number | null; items: CatalogItem[] }
export interface CatalogProgram { name: string; totalCredits: number | null; terms: CatalogTerm[] }
export interface GenEdCategory { name: string; minCredits: number | null; rules: string | null; allowed: string[]; subcategories: Array<{ name: string; minCredits: number | null; allowed: string[] }> }
export interface CatalogYear { program: CatalogProgram | null; genEd: GenEdCategory[] }

/** Catalog term label -> map row. Fr fall, Fr spring, So fall | So spring, So summer, Jr fall | Jr spring + Jr summer, Sr fall, Sr spring. */
const TERM_ROWS: Record<string, { act: Act; slot: Slot }> = {
  'Freshman/First Semester': { act: 1, slot: 0 }, 'Freshman/Second Semester': { act: 1, slot: 1 }, 'Sophomore/First Semester': { act: 1, slot: 2 },
  'Sophomore/Second Semester': { act: 2, slot: 0 }, 'Sophomore/Summer': { act: 2, slot: 1 }, 'Junior/First Semester': { act: 2, slot: 2 },
  'Junior/Second Semester': { act: 3, slot: 0 }, 'Junior/Summer': { act: 3, slot: 0 }, 'Senior/First Semester': { act: 3, slot: 1 }, 'Senior/Second Semester': { act: 3, slot: 2 },
};
export const termRow = (label: string) => TERM_ROWS[label] ?? null;

/** Which General Education category a requirement slot's label stands for (null = not a Gen Ed requirement). */
export function genEdOf(label: string, categories: readonly GenEdCategory[]): string | null {
  const l = label.toLowerCase();
  const by = (name: string) => categories.find(c => c.name.toLowerCase() === name.toLowerCase())?.name ?? null;
  if (l.includes('arts and humanities')) return by('Arts and Humanities');
  if (l.includes('oral communication')) return by('Communication');
  if (l.includes('laboratory science')) return by('Natural Sciences with Lab');
  if (l.includes('global challenges')) return by('Global Challenges');
  if (l.includes('social science')) return by('Social Sciences');
  if (l.includes('mathematic')) return by('Mathematics');
  const exact = categories.find(c => l.startsWith(c.name.toLowerCase()));
  return exact?.name ?? null;
}

const short = (label: string) => label.replace(/\s+Requirement$|\s+Req\.$/i, '');

/**
 * The starting state for a catalog year's recommended plan. Courses the tool tracks are placed as themselves;
 * other catalog courses as catalog courses (title and credits from the catalog); choices and requirement slots
 * as requirement placeholders with their credits. Cards fill each term row left to right in catalog order.
 */
export function planFromCatalog(
  year: string, data: CatalogYear, tracked: ReadonlySet<string>,
  catalog: ReadonlyMap<string, { title: string; credits: string | null; description: string }>,
  newId: (prefix: string) => string, base: PlanState,
): PlanState {
  const program = data.program;
  if (!program) return { ...base, catalogYear: year };
  const placements: Placement[] = [];
  const proposed: ProposedCourse[] = [];
  const requirements: Requirement[] = [];
  const column = new Map<string, number>();
  const put = (ref: string, row: { act: Act; slot: Slot }) => {
    const k = `${row.act}:${row.slot}`;
    const n = column.get(k) ?? 0;
    column.set(k, n + 1);
    placements.push({ ref, act: row.act, branch: null, slot: row.slot, x: n * COL_W });
  };
  const seen = new Set<string>();
  for (const term of program.terms) {
    const row = termRow(term.label);
    if (!row) continue;
    for (const item of term.items) {
      if (item.kind === 'course' && item.code) {
        const code = item.code.trim().toUpperCase().replace(/\s+/g, ' ');
        if (seen.has(code)) continue;
        seen.add(code);
        if (tracked.has(code)) { put(code, row); continue; }
        const cat = catalog.get(code);
        const id = newId('cat');
        proposed.push({
          id, source: 'catalog', code, credits: cat?.credits ?? (item.credits == null ? null : String(item.credits)),
          title: cat?.title ?? code, description: cat?.description ?? '', objectives: [], depths: [],
        });
        put(id, row);
        continue;
      }
      const label = item.kind === 'choice' ? `One of ${item.options.join(', ')}` : short(item.label ?? 'Requirement');
      const id = newId('req');
      requirements.push({
        id, label, credits: item.credits, options: item.kind === 'choice' ? item.options : [],
        genEd: item.kind === 'slot' ? genEdOf(item.label ?? '', data.genEd) : null, notes: item.notes,
      });
      put(id, row);
    }
  }
  return {
    ...base, catalogYear: year, degreeHours: program.totalCredits ?? undefined,
    placements, proposed, requirements,
  };
}

export interface GenEdRow {
  name: string;
  need: number | null;
  /** Placed courses on the catalog's allowed list for this category (trunk only), and their credits. */
  courses: Array<{ code: string; credits: number }>;
  /** Placeholders that stand for this category (a Gen Ed slot, or a choice whose options are all allowed here), and their credits. */
  planned: Array<{ label: string; credits: number }>;
  status: 'met' | 'planned' | 'short';
  rules: string | null;
}

/**
 * The General Education check: per category, the credits placed courses on its allowed list already give, plus
 * placeholders standing for it. 'met' when courses alone reach the minimum; 'planned' when courses and
 * placeholders together do; 'short' otherwise. A course counts once, toward the first category that allows it.
 * Rules the catalog states in words (two different fields, and so on) are shown, not checked.
 */
export function genEdCheck(
  categories: readonly GenEdCategory[],
  courses: ReadonlyArray<{ code: string; credits: number | null; branch: string | null; requirement?: Requirement }>,
): GenEdRow[] {
  const used = new Set<string>();
  return categories.map(cat => {
    const allowed = new Set([...cat.allowed, ...cat.subcategories.flatMap(s => s.allowed)].map(c => c.toUpperCase()));
    const mine: GenEdRow['courses'] = [];
    const planned: GenEdRow['planned'] = [];
    for (const c of courses) {
      if (c.branch !== null) continue;
      if (c.requirement) {
        const r = c.requirement;
        const fits = r.genEd === cat.name || (r.options.length > 0 && r.options.every(o => allowed.has(o.toUpperCase())));
        if (fits && !used.has(r.id)) { used.add(r.id); planned.push({ label: r.label, credits: r.credits ?? 0 }); }
        continue;
      }
      const code = c.code.toUpperCase();
      if (allowed.has(code) && !used.has(code)) { used.add(code); mine.push({ code: c.code, credits: c.credits ?? 0 }); }
    }
    const got = mine.reduce((s, x) => s + x.credits, 0);
    const plan = planned.reduce((s, x) => s + x.credits, 0);
    const need = cat.minCredits;
    const status = need == null || got >= need ? 'met' : got + plan >= need ? 'planned' : 'short';
    return { name: cat.name, need, courses: mine, planned, status, rules: cat.rules };
  });
}
