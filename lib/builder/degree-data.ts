// Server-side access to the exported catalog data (lib/builder/data/degree-plans.json). Kept out of client
// bundles (import it only from server components and routes): pages pass down only what a screen needs
// (the list of years, one year's General Education rules).
import data from './data/degree-plans.json';
import type { CatalogYear, GenEdCategory } from './degree';

const years = (data as unknown as { years: Record<string, CatalogYear> }).years;

/** Catalog years that have a Graphic Communications plan, newest first. */
export const PLAN_YEARS: string[] = Object.keys(years).filter(y => years[y]!.program).sort().reverse();

export function catalogYear(year: string): CatalogYear | null {
  return years[year] ?? null;
}

/** General Education categories for a catalog year; the newest year when none is given or it is unknown. */
export function genEdFor(year: string | undefined): { year: string; categories: GenEdCategory[] } {
  const y = year && years[year] ? year : PLAN_YEARS[0]!;
  return { year: y, categories: years[y]!.genEd };
}
