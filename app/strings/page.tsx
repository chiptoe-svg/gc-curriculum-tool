import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { loadGraph } from '@/lib/db/string-queries';
import { loadLibrary } from '@/lib/builder/library';
import { readString } from '@/lib/builder/strings/read';
import { exactStatuses } from '@/lib/strings/exact';
import { StringsIndex, type IndexRow } from './StringsIndex';
import '../build/build.css';
import '@/components/strings/strings.css';

export const dynamic = 'force-dynamic';

export default async function StringsPage({ searchParams }: { searchParams: Promise<{ slug?: string }> }) {
  const { slug = '' } = await searchParams;
  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }
  const [graph, lib] = await Promise.all([loadGraph({ includeUnlocked: true }), loadLibrary()]);
  const levelOf = (code: string) => lib.courses.find((c) => c.code === code)?.level ?? 0;
  const status = exactStatuses(lib, Object.values(graph.points));
  const rows: IndexRow[] = graph.strings.flatMap((s) => {
    if (s.path.length === 0) return [];
    const r = readString(graph, s.id, status, levelOf, { fade: null });
    const end = r.end;
    const last = r.stops[r.stops.length - 1]!;
    return [{
      id: s.id, name: s.name, status: s.status,
      courses: [...new Set(r.stops.map((x) => x.courseCode))],
      stops: r.stops.length, reinforcement: r.reinforcement,
      endCourse: end.courseCode, endAct: last.act,
      mergesInto: end.kind === 'merges' ? (graph.strings.find((x) => x.id === end.into)?.name ?? 'another string') : null,
    }];
  });
  const q = `?slug=${encodeURIComponent(slug)}`;
  return (
    <div className="cb st-page">
      <Link href={`/build${q}`} className="cb-back">Curriculum builder</Link>
      <h1>Skill strings</h1>
      <p className="cb-muted">A string follows one skill through the courses that build it. Locked strings are the department&rsquo;s record of how a skill develops.</p>
      <StringsIndex rows={rows} query={q} />
    </div>
  );
}
