/**
 * Run the stated-objective ("intended skills") rough pass for named courses
 * from the server, with the same steps as POST /api/admin/courses/intended-skills
 * (mode 'one'): daily-cap check before each call, the same extractor, unknown
 * competency ids dropped, replaceIntendedCoverage, recordSpend.
 *
 * Use when the route cannot be reached (it is admin-only and has no button).
 * It costs money: one AI call per course.
 *
 *   tsx --env-file=<deploy>/.env.local scripts/courses/intended-skills.ts "GC 1010" ["GC 3460" ...]
 *
 * Safety: refuses a course that already has stated-objective rows (pass
 * --replace to overwrite them), and stops the run once RUN_CEILING is spent.
 */
import { getCourseByCode, getIntendedCoverageForCourse, replaceIntendedCoverage, type NewIntendedRow } from '../../lib/db/courses-queries';
import { listTargets } from '../../lib/db/career-targets-queries';
import { isSubCompetencyDefinition } from '../../lib/domain/types';
import { extractIntendedSkills } from '../../lib/ai/analyze/intended-skills-extract';
import { checkDailyCap, recordSpend } from '../../lib/rate-limit/daily-cap';

/** Hard stop for one run, in the cap's own units (1/100 of a cent): $2. */
const RUN_CEILING = 20_000;
const dollars = (units: number) => `$${(units / 10_000).toFixed(4)}`;

async function main() {
  const args = process.argv.slice(2);
  const replace = args.includes('--replace');
  const codes = args.filter(a => !a.startsWith('--'));
  if (codes.length === 0) { console.error('usage: intended-skills.ts "<course code>" [...] [--replace]'); process.exit(2); }

  const targets = await listTargets();
  const subCompetencies = targets.flatMap(t => t.subCompetencies.filter(isSubCompetencyDefinition));
  const valid = new Set(subCompetencies.map(sc => sc.id));
  let spent = 0;

  for (const code of codes) {
    const course = await getCourseByCode(code);
    if (!course) { console.log(`${code}: not found, skipped`); continue; }
    const existing = await getIntendedCoverageForCourse(code);
    if (existing.length > 0 && !replace) { console.log(`${code}: already has ${existing.length} stated rows, skipped (use --replace)`); continue; }
    const catalog = {
      description: course.description ?? '',
      learningObjectives: (course.learningObjectives as string[] | null) ?? [],
      majorProjects: (course.majorProjects as string[] | null) ?? [],
      skillsRequired: (course.skillsRequired as string[] | null) ?? [],
    };
    const hasText = catalog.description.trim() !== '' || catalog.learningObjectives.length > 0
      || catalog.majorProjects.length > 0 || catalog.skillsRequired.length > 0;
    if (!hasText) { console.log(`${code}: no catalog text, skipped`); continue; }

    if (spent >= RUN_CEILING) { console.log(`stopped: this run has spent ${dollars(spent)}, at its ceiling`); break; }
    const cap = await checkDailyCap();
    if (!cap.ok) { console.log('stopped: the daily spending cap is reached'); break; }

    const result = await extractIntendedSkills({ courseCode: code, catalog, subCompetencies });
    const rows: NewIntendedRow[] = [];
    let dropped = 0;
    for (const item of result.items) {
      if (!valid.has(item.sub_competency_id)) { dropped++; continue; }
      rows.push({
        subCompetencyId: item.sub_competency_id, intendedK: item.intended_k, intendedU: item.intended_u, intendedD: item.intended_d,
        confidence: item.confidence, rationale: item.rationale,
      });
    }
    try {
      await replaceIntendedCoverage(code, rows, result.model);
    } finally {
      await recordSpend(result.costUsdCents);
      spent += result.costUsdCents;
    }
    console.log(`${code}: ${rows.length} stated rows written (${dropped} unknown ids dropped), model ${result.model}, cost ${dollars(result.costUsdCents)}, ${Math.round(result.durationMs / 1000)}s`);
    for (const r of rows) console.log(`    ${r.subCompetencyId}  K${r.intendedK ?? '·'} U${r.intendedU ?? '·'} D${r.intendedD ?? '·'}  ${r.confidence}`);
  }
  console.log(`run total: ${dollars(spent)}`);
  process.exit(0);
}
main().catch(e => { console.error(String(e instanceof Error ? e.message : e).slice(0, 500)); process.exit(1); });
