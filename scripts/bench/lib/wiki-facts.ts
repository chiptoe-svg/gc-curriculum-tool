/**
 * Code-based factual check for wiki pages (agents-vs-single-calls benchmark).
 * pageFacts reads the facts a page must state from the substrate (database), never from
 * page text. factualErrors compares a page's markdown to them. Read-only: no DB write,
 * no wiki-repo access. Heavy imports are lazy so factualErrors stays pure and light.
 *
 * Page ids are `<section>/<slug>`: competencies/<slug>, targets/<slug>, courses/<slug>.
 *
 * Fact conventions (what factualErrors reads):
 *  - counts: a key `<group>.<present|partial|absent|unassessed>` is one table row (the
 *    row whose first cell matches <group> must carry the four numbers in that order);
 *    any other key is a label that the text may state as "N <label>", "<label> (N)" or
 *    "<label>: N".  Any "X of Y" in the text where Y equals a fact count must have X
 *    equal to a fact count too (10 of 18 fails when the facts are 11 and 18).
 *  - courseLists: a line (or, for a heading, its section) that contains the list name
 *    must name exactly those courses.
 *  - targets: the career-target slugs that exist now; a `targets/<slug>` reference or a
 *    `career_target:` value outside the set is stale.
 */
export interface PageFacts { pageId: string; counts: Record<string, number>; courseLists: Record<string, string[]>; targets: string[] }
export interface FactualError { kind: 'count' | 'course-list' | 'stale-target'; detail: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COURSE_TOKEN = /\b([a-z]{2,4})[- ](\d{4}[a-z]*)\b/gi;
const courseTokens = (s: string): string[] => [...s.matchAll(COURSE_TOKEN)].map(m => `${m[1]}-${m[2]}`.toLowerCase());
const ROW_ORDER = ['present', 'partial', 'absent', 'unassessed'] as const;

/** Phrase-normalized text: lowercase, non-alphanumerics to single spaces. */
const phrase = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STATUS: Array<[typeof ROW_ORDER[number], RegExp]> = [
  ['unassessed', /\bnot assessed\b|\bunassessed\b/], ['present', /\bpresent\b/], ['partial', /\bpartial(?:ly)?\b/], ['absent', /\babsent\b/],
];

interface CountResult { errors: FactualError[]; unverifiable: string[] }

function countCheck(md: string, facts: PageFacts): CountResult {
  const errs: FactualError[] = [];
  const unverifiable: string[] = [];

  const groups = new Map<string, Array<number | undefined>>();
  const labels = new Map<string, number>();
  for (const [k, v] of Object.entries(facts.counts)) {
    const m = k.match(/^(.*)\.(present|partial|absent|unassessed)$/);
    if (!m) { labels.set(phrase(k), v); continue; }
    const row = groups.get(phrase(m[1]!)) ?? [];
    row[ROW_ORDER.indexOf(m[2] as typeof ROW_ORDER[number])] = v;
    groups.set(phrase(m[1]!), row);
  }
  const totals = new Set<number>(labels.values());
  for (const row of groups.values()) totals.add(row.reduce<number>((a, b) => a + (b ?? 0), 0));

  // "X of Y": tie it to the group or label named in the same sentence.
  for (const sentence of md.split(/[.;!?\n|]+/)) {
    const text = phrase(sentence);
    for (const m of text.matchAll(/\b(\d+) of (\d+)\b/g)) {
      const x = Number(m[1]), y = Number(m[2]), at = m.index!;
      const named: Array<{ name: string; at: number; kind: 'group' | 'label' }> = [];
      for (const name of groups.keys()) { const i = text.indexOf(name); if (i >= 0) named.push({ name, at: i, kind: 'group' }); }
      for (const name of labels.keys()) { const i = text.indexOf(name); if (i >= 0) named.push({ name, at: i, kind: 'label' }); }
      const before = named.filter(n => n.at < at).sort((a, b) => b.at - a.at)[0];
      const after = named.filter(n => n.at >= at).sort((a, b) => a.at - b.at)[0];
      const hit = before ?? after;
      if (!hit) { unverifiable.push(`"${m[0]}": no known group or label in the sentence "${sentence.trim()}"`); continue; }
      if (hit.kind === 'label') {
        const want = labels.get(hit.name)!;
        if (y !== want) errs.push({ kind: 'count', detail: `"${m[0]}" of ${hit.name}: the facts say ${want} in total` });
        continue;
      }
      const row = groups.get(hit.name)!;
      const status = STATUS.find(([, re]) => re.test(text))?.[0];
      const total = row.reduce<number>((a, b) => a + (b ?? 0), 0);
      if (status) {
        const want = row[ROW_ORDER.indexOf(status)];
        if (want !== undefined && x !== want) errs.push({ kind: 'count', detail: `"${m[0]}": ${hit.name} ${status} is ${want} in the facts` });
      } else if (!row.includes(x)) {
        errs.push({ kind: 'count', detail: `"${m[0]}": ${hit.name} has no count of ${x} (facts: ${row.join('/')})` });
      }
      if (!totals.has(y)) errs.push({ kind: 'count', detail: `"${m[0]}": the facts have no total of ${y} for ${hit.name} (totals: ${[...totals].sort((a, b) => a - b).join(', ')})` });
    }
  }

  // Table rows: <group>.present/partial/absent/unassessed; "(all)" style qualifiers and "11 (61%)" cells are tolerated.
  for (const line of md.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    const name = phrase((cells[0] ?? '').replace(/\([^)]*\)/g, ''));
    const want = groups.get(name);
    if (!want) continue;
    const got = cells.slice(1, 5).map(c => { const m = c.match(/^(\d+)\b/); return m ? Number(m[1]) : undefined; });
    if (ROW_ORDER.some((_, i) => want[i] !== undefined && got[i] !== want[i])) {
      errs.push({ kind: 'count', detail: `${name} row reads ${got.join('/')} but the facts are ${want.join('/')} (present/partial/absent/not assessed)` });
    }
  }

  // Labelled counts stated in prose: "N label", "N of M label" (M is the count), "label (N)", "label: N".
  for (const [label, v] of Object.entries(facts.counts)) {
    if (/\.(present|partial|absent|unassessed)$/.test(label)) continue;
    const l = escapeRe(label.toLowerCase().replace(/s$/, '')).replace(/\s+/g, '\\s+') + '(?:s|\\(s\\))?';
    const found: number[] = [];
    for (const m of md.matchAll(new RegExp(`\\b(\\d+)\\s+(?:of\\s+(\\d+)\\s+)?${l}`, 'gi'))) found.push(Number(m[2] ?? m[1]));
    for (const re of [new RegExp(`${l}\\W{0,4}\\((\\d+)\\)`, 'gi'), new RegExp(`${l}[^|\\n\\d]{0,3}:\\s*(\\d+)`, 'gi')]) {
      for (const m of md.matchAll(re)) found.push(Number(m[1]));
    }
    for (const n of found) if (n !== v) errs.push({ kind: 'count', detail: `states ${n} for "${label}" but the facts say ${v}` });
  }
  return { errors: errs, unverifiable };
}

function listRegion(lines: string[], i: number): string {
  if (!/^\s*#/.test(lines[i]!)) return lines[i]!;
  const out = [lines[i]!];
  for (let j = i + 1; j < lines.length && !/^\s*#/.test(lines[j]!); j++) out.push(lines[j]!);
  return out.join('\n');
}

function courseListErrors(md: string, facts: PageFacts): FactualError[] {
  const errs: FactualError[] = [];
  const seen = new Set<string>();
  const lines = md.split('\n');
  for (const [name, expected] of Object.entries(facts.courseLists)) {
    const key = norm(name);
    const want = new Set(expected.map(c => c.toLowerCase().replace(/\s+/g, '-')));
    lines.forEach((line, i) => {
      if (!norm(line).includes(key)) return;
      const stated = new Set(courseTokens(listRegion(lines, i)));
      if (stated.size === 0) return; // this line names the list but lists no courses
      const add = (detail: string) => { if (!seen.has(detail)) { seen.add(detail); errs.push({ kind: 'course-list', detail }); } };
      for (const c of want) if (!stated.has(c)) add(`"${name}" omits ${c}`);
      for (const c of stated) if (!want.has(c)) add(`"${name}" lists ${c}, which is not in the facts`);
    });
  }
  return errs;
}

function targetErrors(md: string, facts: PageFacts): FactualError[] {
  const known = new Set(facts.targets);
  const refs = new Set<string>();
  for (const m of md.matchAll(/\btargets\/([a-z0-9][a-z0-9-]*)/gi)) refs.add(m[1]!.toLowerCase());
  for (const m of md.matchAll(/^career_target:\s*"?([a-z0-9][a-z0-9-]*)"?\s*$/gim)) if (m[1] !== 'null') refs.add(m[1]!.toLowerCase());
  refs.delete('index');
  return [...refs].filter(r => !known.has(r)).map(r => ({ kind: 'stale-target' as const, detail: `refers to target "${r}", which is not a current career target` }));
}

/** Errors, plus the "X of Y" statements whose group could not be identified (neither passed nor failed). */
export function factualCheck(markdown: string, facts: PageFacts): { errors: FactualError[]; unverifiable: string[] } {
  const c = countCheck(markdown, facts);
  return { errors: [...c.errors, ...courseListErrors(markdown, facts), ...targetErrors(markdown, facts)], unverifiable: c.unverifiable };
}

export function factualErrors(markdown: string, facts: PageFacts): FactualError[] {
  return factualCheck(markdown, facts).errors;
}

export async function pageFacts(pageId: string): Promise<PageFacts> {
  const [section, slug] = pageId.split('/');
  if (!section || !slug) throw new Error(`pageId must be <section>/<slug>: ${pageId}`);
  const [{ db }, { careerTargets, courses }, update] = await Promise.all([
    import('@/lib/db/client'), import('@/lib/db/schema'), import('@/lib/ai/wiki/update'),
  ]);
  const targets = (await db.select({ id: careerTargets.id }).from(careerTargets)).map(r => r.id);
  const facts: PageFacts = { pageId, counts: {}, courseLists: {}, targets };

  if (section === 'competencies' && slug === 'problem-solving') {
    const [{ loadProblemSolvingInputs }, { buildProblemSolvingProfile }] = await Promise.all([
      import('@/lib/db/problem-solving-queries'), import('@/lib/program/problem-solving-profile'),
    ]);
    const inputs = await loadProblemSolvingInputs();
    const p = buildProblemSolvingProfile(inputs.courses, inputs.depths);
    for (const [k, c] of Object.entries(p.conditionCounts)) {
      const g = k.replace(/_/g, ' ');
      facts.counts[`${g}.present`] = c.present; facts.counts[`${g}.partial`] = c.partial;
      facts.counts[`${g}.absent`] = c.absent; facts.counts[`${g}.unassessed`] = c.unassessed;
    }
    facts.counts['captured courses'] = p.coursesWithData;
    const labels: Record<string, string> = { significant: 'Significant evidence', moderate: 'Moderate evidence', slight: 'Slight evidence', none: 'No evidence of the conditions', no_data: 'No condition data yet' };
    for (const [band, label] of Object.entries(labels)) {
      const codes = p.bands[band as keyof typeof p.bands];
      facts.counts[label] = codes.length;
      facts.courseLists[label] = codes.map(update.courseCodeToSlug);
    }
    return facts;
  }
  if (section === 'competencies') {
    const s = await update.loadCompetencySubstrate(slug);
    const slugs = [...new Set(s.contributingCells.map(c => c.courseSlug))];
    facts.counts['contributing courses'] = slugs.length;
    facts.courseLists['contributing courses'] = slugs;
    return facts;
  }
  if (section === 'targets') {
    const s = await update.loadTargetSubstrate(slug);
    facts.counts['competencies'] = s.coverageRollup.length;
    facts.counts['scored competencies'] = s.coverageRollup.filter(e => e.scored).length;
    facts.counts['contributing courses'] = s.contributingCourses.length;
    facts.courseLists['contributing courses'] = s.contributingCourses;
    return facts;
  }
  if (section === 'courses') {
    const code = (await db.select({ code: courses.code }).from(courses)).map(r => r.code).find(c => update.courseCodeToSlug(c) === slug);
    if (!code) throw new Error(`no course for page ${pageId}`);
    const { getLatestSnapshotByCourse } = await import('@/lib/db/capture-snapshots-queries');
    const snap = await getLatestSnapshotByCourse(code);
    if (!snap) throw new Error(`no snapshot for ${code}`);
    const info = await update.loadCourseInfo(code);
    facts.counts['competencies'] = snap.profile.competencies?.length ?? 0;
    facts.courseLists['prerequisites'] = info.prerequisites.map(update.courseCodeToSlug);
    return facts;
  }
  throw new Error(`unsupported page section: ${section}`);
}
