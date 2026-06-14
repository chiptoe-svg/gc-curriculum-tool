import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { deriveEvidenceBand } from '@/lib/program/evidence-ladder';
import { BAND_MARKER } from '@/lib/ai/wiki/evidence-band-markers';

export interface ProfileToOkfInput {
  course: {
    code: string; title: string;
    prefix?: string | null; level?: number | null; track?: string | null;
    buildsToCareer?: boolean | null; catalogUrl?: string | null;
  };
  profile: CaptureProfile;
  snapshot: { id: string; createdAt: Date | string; instructorName: string | null };
  viewUrl?: string;
}

const slugify = (code: string): string => code.toLowerCase().replace(/\s+/g, '-');
const yamlStr = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s*\n\s*/g, ' ').trim()}"`;
const depthChip = (label: 'K' | 'U' | 'D', v: number | null | undefined): string | null => (v == null ? null : `${label}${v}`);

/** Deterministic OKF-v0.1 markdown projection of a captured course profile.
 *  Pure — no I/O, no AI. The portable, self-contained face of the profile. */
export function profileToOkfMarkdown(input: ProfileToOkfInput): string {
  const { course, profile, snapshot, viewUrl } = input;
  const ts = typeof snapshot.createdAt === 'string' ? snapshot.createdAt : snapshot.createdAt.toISOString();
  const description = profile.overview?.narrative?.split(/\n\s*\n/)[0]?.trim()
    || profile.verification_summary?.course_shape || course.title;

  const tags = [
    course.prefix ? course.prefix.toLowerCase() : null,
    course.level != null ? `level-${course.level}` : null,
    course.track && course.track !== 'unspecified' ? course.track : null,
    course.buildsToCareer ? 'builds-to-career' : null,
  ].filter((t): t is string => !!t);

  const resource = viewUrl || course.catalogUrl || null;

  const out: string[] = [
    '---',
    'type: course',
    `title: ${yamlStr(`${course.code} — ${course.title}`)}`,
    `description: ${yamlStr(description)}`,
    `slug: ${slugify(course.code)}`,
    `tags: [${tags.join(', ')}]`,
    `timestamp: ${ts}`,
    ...(resource ? [`resource: ${resource}`] : []),
    `instructor: ${yamlStr(snapshot.instructorName ?? 'Department canonical')}`,
    `snapshot_id: ${snapshot.id}`,
    `scale_version: ${profile.scale_version}`,
    '---',
    '',
  ];
  const push = (s: string) => out.push(s);

  push(`# ${course.code} — ${course.title}`);
  push('');
  if (profile.overview?.narrative) { push(profile.overview.narrative.trim()); push(''); }

  const apparent = profile.revised_objectives_draft ?? [];
  if (apparent.length) {
    push('## Apparent outcomes');
    push('Based on the materials and interview, this is what the course appears to deliver.');
    push('');
    for (const o of apparent) push(`- ${o}`);
    push('');
  }

  const comps = (profile.competencies ?? []).filter(c => c.statement);
  if (comps.length) {
    push('## Competencies developed');
    push('');
    for (const c of comps) {
      const foundational = c.type === 'foundational';
      const chips = [foundational ? null : depthChip('K', c.k_depth), foundational ? null : depthChip('U', c.u_depth), depthChip('D', c.d_depth)].filter(Boolean).join(' ');
      const band = BAND_MARKER[deriveEvidenceBand({ source: c.source, citations: c.citations })];
      push(`- **${c.statement}** — ${chips} ${band}`);
      if (c.evidence_d) push(`  - Evidence: ${c.evidence_d}`);
    }
    push('');
  }

  const incoming = (profile.incoming_expectations ?? []).filter(e => e.statement);
  if (incoming.length) {
    push('## Incoming expectations');
    push('What students are expected to arrive able to do.');
    push('');
    for (const e of incoming) {
      const chips = [depthChip('K', e.expected_depth?.k), depthChip('U', e.expected_depth?.u), depthChip('D', e.expected_depth?.d)].filter(Boolean).join(' ');
      push(`- ${e.statement}${chips ? ` — ${chips}` : ''}`);
    }
    push('');
  }

  const cs = profile.class_structure;
  if (cs && (cs.cadence || (cs.topics?.length ?? 0) > 0 || cs.assessment)) {
    push('## Class structure');
    if (cs.cadence) push(`- Cadence: ${cs.cadence}`);
    if ((cs.topics?.length ?? 0) > 0) push(`- Topics: ${cs.topics!.join(', ')}`);
    if (cs.assessment) push(`- Assessment: ${cs.assessment}`);
    push('');
  }

  const projects = (profile.major_projects ?? []).filter(p => p.title);
  if (projects.length) {
    push('## Major projects');
    push('');
    for (const p of projects) push(`- **${p.title}**${p.description ? ` — ${p.description}` : ''}`);
    push('');
  }

  const emphasis = (profile.course_emphasis ?? []).filter(e => e.competency);
  if (emphasis.length) {
    push('## Course emphasis');
    push("What the course's graded work weights (independent of depth scoring).");
    push('');
    for (const e of emphasis) push(`- ${e.competency} — ${e.centrality} (${e.points} pts · ${e.share_pct}%)`);
    push('');
  }

  push('## Citations');
  push('');
  const cites = [
    ...(profile.verification_summary?.strongest_evidence ?? []),
    ...comps.map(c => c.evidence_d).filter((e): e is string => !!e),
  ];
  const seen = new Set<string>();
  for (const c of cites) { if (!seen.has(c)) { seen.add(c); push(`- ${c}`); } }
  push('');
  push(`_Source: immutable snapshot \`${snapshot.id}\`${resource ? ` · ${resource}` : ''} · captured ${ts.slice(0, 10)}._`);
  push('');
  push('---');
  push('_Depth scale (0–5): 0 not present · 1 exposure · 2 recognize · 3 recall/predict/perform independently · 4 use correctly/reason in novel cases/adapt · 5 fluent + edge cases. K=Know, U=Understand, D=Do._');

  return out.join('\n') + '\n';
}
