import { WHAT_IF_COPY } from '@/lib/what-if/copy';
import { kudText } from '@/lib/what-if/format-rating';
import type { WhatIfSkills } from '@/lib/what-if/types';
import { DeleteWhatIf } from './DeleteWhatIf';

/** A skills-only what-if (saved from a cluster): its objectives and skills, no estimate, knock-on or prose sections. */
export function SkillsOnlyPage({ view, canManage, slug }: {
  view: { id: string; courseCode: string; title: string | null; authorName: string; skills: WhatIfSkills };
  canManage: boolean;
  slug: string;
}) {
  const { skills } = view;
  const q = `?slug=${encodeURIComponent(slug)}`;
  return (
    <div className="wiki-index wiki-page whatif-page">
      <header className="wiki-index__top">
        <p className="wiki-page__kind">{view.courseCode}</p>
        <h1 className="wiki-index__title wiki-page__title">{view.title ?? WHAT_IF_COPY.untitled}</h1>
        <div className="mt-3 max-w-2xl rounded border-2 border-foreground px-4 py-3">
          <p className="text-base"><strong>{WHAT_IF_COPY.banner}</strong></p>
          <p className="mt-1 text-sm">{WHAT_IF_COPY.skillsOnlyExplain}</p>
        </div>
        <p className="wiki-index__status"><strong>{WHAT_IF_COPY.skillsOnlyLabel}</strong></p>
        <p className="wiki-index__status">{view.authorName}</p>
      </header>
      <div className="wiki-page__body">
        <article className="wiki-prose">
          <h2>{WHAT_IF_COPY.skillsOnlyObjectives}</h2>
          {skills.objectives.length > 0 ? <ul>{skills.objectives.map((o, n) => <li key={n}>{o}</li>)}</ul> : <p>{WHAT_IF_COPY.skillsOnlyNone}</p>}
          <h2>{WHAT_IF_COPY.skillsOnlyDeveloped}</h2>
          {skills.developed.length > 0
            ? <ul>{skills.developed.map((s, n) => <li key={n}>{s.statement} ({kudText({ k: s.k, u: s.u, d: s.d })})</li>)}</ul>
            : <p>{WHAT_IF_COPY.skillsOnlyNone}</p>}
          <h2>{WHAT_IF_COPY.skillsOnlyRequired}</h2>
          {skills.required.length > 0
            ? <ul>{skills.required.map((r, n) => <li key={n}>{r.statement} ({kudText(r.need)})</li>)}</ul>
            : <p>{WHAT_IF_COPY.skillsOnlyNone}</p>}
          <p><a href={`/explore/${encodeURIComponent(view.courseCode)}${q}`}>{WHAT_IF_COPY.listLink}</a></p>
          {canManage && <DeleteWhatIf courseCode={view.courseCode} whatIfId={view.id} slug={slug} />}
        </article>
      </div>
    </div>
  );
}
