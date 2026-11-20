import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isValidSlug } from '@/lib/slug';
import { loadGraph } from '@/lib/db/string-queries';
import { loadLibrary } from '@/lib/builder/library';
import { clusterStringHref } from '@/lib/builder/strings/href';
import { courseEvidence } from '@/lib/builder/strings/evidence';
import { exactStatuses } from '@/lib/strings/exact';
import { UUID } from '@/lib/strings/api';
import { loadTree } from '@/lib/db/skill-tree-queries';
import { versionsData } from '@/lib/builder/strings/versions';
import { StringView } from './StringView';
import '../../build/build.css';
import '@/components/strings/strings.css';

export const dynamic = 'force-dynamic';

export default async function StringPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ slug?: string }>;
}) {
  const { id } = await params;
  const { slug = '' } = await searchParams;
  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }
  if (!UUID.test(id)) notFound();
  const [all, lib, tree] = await Promise.all([loadGraph({ includeUnlocked: true }), loadLibrary(), loadTree()]);
  // The whole graph, not one string: the panel names the strings this one merges into or shares stops with.
  const graph = all;
  if (!graph.strings.some((s) => s.id === id)) notFound();

  const levels: Record<string, number> = {};
  const evidence: Record<string, string[]> = {};
  for (const p of Object.values(graph.points)) {
    const c = lib.courses.find((x) => x.code === p.courseCode);
    if (!c) continue;
    levels[c.code] = c.level;
    evidence[c.code] = courseEvidence(lib, c.code);
  }
  const codes = [...new Set(graph.strings.find((s) => s.id === id)!.path.map((p) => graph.points[p]?.courseCode ?? ''))].filter(Boolean);
  return (
    <div className="cb st-page">
      <Link href={`/strings?slug=${encodeURIComponent(slug)}`} className="cb-back">All strings</Link>
      <StringView
        initialGraph={graph} initialStatus={exactStatuses(lib, Object.values(graph.points))} stringId={id}
        tree={tree} versions={versionsData(lib, Object.keys(levels))}
        levels={levels} evidence={evidence} editHref={clusterStringHref(codes, `?slug=${encodeURIComponent(slug)}`)} query={`?slug=${encodeURIComponent(slug)}`}
      />
    </div>
  );
}
