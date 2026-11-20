import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { loadLibrary } from '@/lib/builder/library';
import { loadCareerRequirements, loadTree } from '@/lib/db/skill-tree-queries';
import { careerWeights, readCareer, readProgram } from '@/lib/skill-tree/read';
import type { VersionSkills } from '@/lib/skill-tree/types';
import { ReadingTree } from '../shared/SkillTreePanel';
import '../build.css';

export const dynamic = 'force-dynamic';

const one = (n: number | null): string => (n === null ? '–' : n.toFixed(1));

export default async function TreePage({ searchParams }: { searchParams: Promise<{ slug?: string }> }) {
  const { slug = '' } = await searchParams;
  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }
  const [tree, lib, career] = await Promise.all([loadTree(), loadLibrary(), loadCareerRequirements()]);
  // Every course's captures: newest per instructor (the library already holds one per instructor).
  const versions: VersionSkills[] = lib.courses.flatMap((c) => c.versions.map((v) => ({
    courseCode: c.code, instructor: v.instructorName ?? '',
    skills: new Map(v.skills.map((s) => [s.skillRef, { k: s.k, u: s.u, d: s.d }])),
  })));
  const masters = tree.nodes.filter((n) => !n.parentId && !n.retired && !n.mergedInto);
  const readings = masters.map((m) => readProgram(tree, versions, m.id));
  const careers = career.targets.map((t) => {
    const weights = careerWeights(career.rows.filter((r) => r.careerTargetId === t.id)).filter((w) => tree.nodes.some((n) => n.id === w.nodeId));
    return { id: t.id, name: t.name, reading: weights.length ? readCareer(tree, versions, weights) : null, count: weights.length };
  });

  return (
    <div className="cb cb-index">
      <header className="cb-index__head">
        <Link href={`/build?slug=${encodeURIComponent(slug)}`} className="cb-back">Curriculum builder</Link>
        <h1>Department skill tree</h1>
        <p>
          Every competency with what the department&rsquo;s courses reach under it, as Know, Understand and Do. At each
          skill, the strongest course counts, separately for Know, Understand and Do. Open a competency to see the skills under it.
        </p>
      </header>
      <section className="cb-index__list">
        <h2>Competencies</h2>
        <ReadingTree tree={tree} readings={readings} />
      </section>
      <section className="cb-index__list">
        <h2>Career paths</h2>
        <p className="cb-muted">
          What the program reaches across the competencies each career path asks for at entry, weighted by how much it asks
          for each (employer weights first, then faculty, O*NET, and AI).
        </p>
        {careers.length === 0 ? <p className="cb-empty">No career paths yet.</p> : (
          <ul>
            {careers.map((c) => (
              <li key={c.id}>
                <span className="cb-index__name">{c.name}</span>{' '}
                <span className="cb-mono">
                  {c.reading ? `K${one(c.reading.k)} U${one(c.reading.u)} D${one(c.reading.d)}` : 'No competencies weighted yet'}
                </span>
                {c.reading && <span className="cb-index__meta"> across {c.count} {c.count === 1 ? 'competency' : 'competencies'}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
