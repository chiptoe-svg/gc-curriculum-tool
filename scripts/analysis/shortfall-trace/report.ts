/** Builds the trace input from the extract plus worksheets, and renders the Markdown report. Pure. */
import type { Extract } from './extract-build';
import {
  GATES, HOLD_FRACTION, HOLD_VARIANTS, MAX_STEPS, dimsOf,
  type Analysis, type Depth, type FixSet, type Link, type Shortfall, type TraceInput,
} from './model';

export function buildInput(extract: Extract, required: Record<string, Depth>, links: Link[]): TraceInput {
  const exits: TraceInput['exits'] = {};
  const captured: TraceInput['captured'] = {};
  for (const c of extract.courses) {
    captured[c.code] = c.captured;
    exits[c.code] = Object.fromEntries(Object.entries(c.depths).map(([id, d]) => [id, { k: d.k, u: d.u, d: d.d }]));
  }
  return {
    courses: extract.path,
    competencies: extract.competencies.map(c => ({ id: c.id, foundational: c.foundational, weight: c.weight })),
    exits, captured, links, required,
  };
}

export interface Run { name: string; input: TraceInput; analysis: Analysis; warnings: string[] }

const DIM = (d: string) => d.toUpperCase();
const pct = (n: number) => `${Math.round(n * 100)}%`;
const stepText = (s: FixSet['steps'][number], dim: string) => `${s.course} ${DIM(dim)}${s.from} to ${DIM(dim)}${s.to}${s.unknown ? ' (not captured)' : ''}`;
const setLabel = (f: FixSet, dim: string) => f.steps.map(s => stepText(s, dim)).join(' and ');
const gateWord = (f: FixSet) => GATES.map(g => `${g} ${f.variants[g] ? 'closes' : 'does not close'}`).join(', ');
const row = (cells: Array<string | number>) => `| ${cells.join(' | ')} |`;
const table = (head: string[], rows: Array<Array<string | number>>) =>
  [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');

function fixLine(f: FixSet, dim: string): string {
  const frac = f.perturbFraction == null ? 'no perturbation possible' : `${f.perturbClosed} of ${f.perturbTotal} (${pct(f.perturbFraction)})`;
  return `- ${setLabel(f, dim)}${f.unverified ? ' **[unverified: touches a course that is not captured]**' : ''}. `
    + `Gates: ${gateWord(f)} (${f.variantsClosed} of 3). One-level perturbations under gate b: closes in ${frac}. `
    + `**${f.holds ? 'Holds' : 'Does not hold'}**${!f.holds && f.variantsClosed < HOLD_VARIANTS ? ' (flips with the gate)' : ''}.`;
}

function shortfallSection(s: Shortfall, run: Run, extract: Extract): string {
  const name = extract.competencies.find(c => c.id === s.competency)?.name ?? s.competency;
  const out: string[] = [];
  out.push(`#### ${s.competency} ${DIM(s.dim)}: required ${s.required}, attained ${s.attained}, short by ${s.gap}`, '', name, '');
  if (s.peakCourse) {
    const chainRows = s.chain.map(code => {
      const c = extract.courses.find(x => x.code === code)!;
      const exit = run.input.exits[code]?.[s.competency]?.[s.dim];
      const val = !c.captured ? 'not captured' : exit == null ? 'captured, no reading for this competency' : `${DIM(s.dim)}${exit} (captured snapshot)`;
      return [code, c.title, val, code === s.peakCourse ? 'where attained peaks' : ''];
    });
    out.push(`Chain feeding ${s.peakCourse}, where attained first peaks:`, '', table(['Course', 'Title', 'Exit depth', ''], chainRows), '');
  } else {
    out.push('No course delivers any level on this dimension, so there is no chain.', '');
  }
  if (s.unknownInChain.length) out.push(`Unknown values counted as 0 in this chain: ${s.unknownInChain.join(', ')}.`, '');
  out.push(`Single +1 what-ifs (gate b) that shrink the gap: ${s.singles.length
    ? s.singles.map(x => `${x.course} ${DIM(s.dim)}${x.from} to ${x.to} leaves a gap of ${x.gapAfter}${x.closes ? ' (closes)' : ''}`).join('; ')
    : 'none'}.`, '');
  if (s.noFixWithinThree) out.push(`**No set of up to ${MAX_STEPS} +1 steps closes this shortfall.**`, '');
  else out.push(`Minimal fix sets (every set that closes the gap and has no smaller set inside it; up to ${MAX_STEPS} steps; none is preferred):`, '', ...s.fixSets.map(f => fixLine(f, s.dim)), '');
  return out.join('\n');
}

function runSection(run: Run, extract: Extract, level: string): string {
  const out: string[] = [];
  const { shortfalls, credit, gates } = run.analysis;
  out.push(`${level} Faculty: ${run.name}`, '');
  if (run.warnings.length) out.push(...run.warnings.map(w => `- Warning: ${w}`), '');
  out.push(`${level}# Shortfalls`, '');
  out.push(shortfalls.length
    ? table(['Competency', 'Dim', 'Required', 'Attained', 'Short by', 'Peaks at', 'Fix sets that hold'],
      shortfalls.map(s => [s.competency, DIM(s.dim), s.required, s.attained, s.gap, s.peakCourse ?? 'none', s.fixSets.length ? `${s.fixSets.filter(f => f.holds).length} of ${s.fixSets.length}` : 'no fix within 3 steps']))
    : 'No shortfalls under gate b.', '');
  for (const s of shortfalls) out.push(shortfallSection(s, run, extract));

  out.push(`${level}# What this target loses without the course`, '',
    'Remove one course (it delivers nothing, students pass through), recompute under gate b, and show how far attained drops. This is separate from the builder\'s skill-share bars. The weighted total is the sum over competencies and dimensions of weight times the drop; it is an index for ordering courses, not a depth.', '');
  const cells = extract.competencies.flatMap(c => dimsOf({ id: c.id, foundational: c.foundational, weight: c.weight }).map(dim => ({ id: c.id, dim })));
  out.push(table(['Course', ...cells.map(c => `${c.id} ${DIM(c.dim)}`), 'Weighted total'],
    credit.map(r => [r.course, ...cells.map(c => r.drops.find(d => d.competency === c.id && d.dim === c.dim)?.drop ?? 0), r.weightedTotal.toFixed(2)])), '');

  out.push(`${level}# Does the gate change the answer?`, '',
    'Gate a is the plain "highest exit depth on the path" view. Gates b and c apply the prerequisite gate. Cells show the shortfall (required minus attained, 0 when met) and attained.', '');
  const interesting = gates.filter(g => g.required != null);
  out.push(table(['Competency', 'Dim', 'Required', 'Gate a short (attained)', 'Gate b short (attained)', 'Gate c short (attained)', 'Gate changes the answer'],
    interesting.map(g => [g.competency, DIM(g.dim), g.required!, ...GATES.map(k => `${g.gap[k]} (${g.attained[k]})`), g.differs ? 'yes' : 'no'])), '');
  const flipped = interesting.filter(g => g.differs);
  out.push(flipped.length
    ? `The gate changes the shortfall on ${flipped.length} of ${interesting.length} required cells: ${flipped.map(g => `${g.competency} ${DIM(g.dim)}`).join(', ')}.`
    : 'The gate does not change any shortfall: the plain highest-exit view gives the same answer.', '');
  return out.join('\n');
}

/** Where two or more faculty members' results differ. Each is reported separately; nothing is averaged. */
export function compareFaculty(runs: Array<{ name: string; analysis: Analysis }>): string[] {
  const keys = new Set(runs.flatMap(r => r.analysis.shortfalls.map(s => `${s.competency} ${DIM(s.dim)}`)));
  const lines: string[] = [];
  for (const key of [...keys].sort()) {
    const per = runs.map(r => {
      const s = r.analysis.shortfalls.find(x => `${x.competency} ${DIM(x.dim)}` === key);
      return { name: r.name, s, sets: s ? s.fixSets.map(f => `${setLabel(f, s.dim)}${f.holds ? ' [holds]' : ' [does not hold]'}`).sort() : [] };
    });
    const same = per.every(p => (p.s?.gap ?? 0) === (per[0]!.s?.gap ?? 0) && p.sets.join('|') === per[0]!.sets.join('|'));
    if (same) continue;
    lines.push(`- ${key}`);
    for (const p of per) {
      lines.push(`  - ${p.name}: ${p.s ? `gap ${p.s.gap} (required ${p.s.required}, attained ${p.s.attained}); fix sets: ${p.sets.length ? p.sets.join('; ') : 'none within 3 steps'}` : 'no shortfall'}`);
    }
  }
  return lines.length ? lines : ['The faculty results are identical on every shortfall and fix set.'];
}

export function renderReport(extract: Extract, runs: Run[], opts: { synthetic: boolean }): string {
  const out: string[] = [];
  if (opts.synthetic) out.push('SYNTHETIC DRY RUN: the required depths and links are generated from the captured depths, not given by faculty. Nothing here is a finding.', '');
  out.push(`# Shortfall trace: ${extract.target.name}`, '');
  out.push(
    `Read-only analysis. Extracted ${extract.courses.length} path courses from live captures; no AI calls, no database writes.`, '',
    '## Method in brief', '',
    '- Depths are ordinal 0 to 5 per Know, Understand, Do. Each (competency, dimension) is worked alone over the path in prerequisite order. Foundational competencies use Do only and have no links.',
    '- exit = the course\'s captured depth; an unknown (not captured, or no reading) counts as 0 and is flagged. arrival = highest carried depth among earlier courses with a real link. short = the largest amount by which arrival falls under an expected incoming depth on a real link. Delivered depth by gate: (a) the exit depth; (b) exit minus short, not below 0; (c) the lower of exit and arrival when short. carried = the higher of arrival and delivered, so depth never fades. attained = the highest carried depth on the path.',
    '- A fix is one or more +1 steps on a course\'s exit (a cell may take repeated steps, capped at 5). Minimal fix sets are searched exactly up to 3 steps, under gate b.',
    `- Ruling: a fix "holds" if it closes the shortfall in at least ${HOLD_VARIANTS} of the 3 gates and in at least ${pct(HOLD_FRACTION)} of the one-level perturbations (each captured exit moved up or down one level, one at a time, under gate b; a move past 0 or 5 is skipped; a perturbation in which the shortfall closes by itself counts as closed). The ${pct(HOLD_FRACTION)} threshold is a judgment call, not derived.`,
    '- Evidence labels: every depth is either "captured snapshot" or "not captured". A fix that touches a course that is not captured is "unverified".', '',
    `Coverage-reading rule: ${extract.rule}`, '',
    '## Evidence: captured depths on the path', '');
  const head = ['Course', 'Evidence', ...extract.competencies.map(c => c.id)];
  out.push(table(head, extract.courses.map(c => [
    `${c.code} ${c.title}`,
    c.captured ? `captured snapshot ${c.snapshotId!.slice(0, 8)} (${c.snapshotCreatedAt!.slice(0, 10)})${c.liveSnapshots > 1 ? `, ${c.liveSnapshots} live snapshots, newest scored used` : ''}` : `not captured (${c.note})`,
    ...extract.competencies.map(k => {
      const d = c.depths[k.id];
      if (!c.captured) return 'not captured';
      if (!d) return 'no reading';
      return k.foundational ? `D${d.d}` : `K${d.k ?? '-'}/U${d.u ?? '-'}/D${d.d}`;
    }),
  ])), '', `Weights for this target: ${extract.competencies.map(c => `${c.id} ${c.weight ?? 'n/a'}`).join(', ')}.`, '');
  for (const r of runs) out.push(runSection(r, extract, '##'));
  if (runs.length > 1) out.push('## Where the faculty results differ', '', ...compareFaculty(runs), '');
  return out.join('\n');
}
