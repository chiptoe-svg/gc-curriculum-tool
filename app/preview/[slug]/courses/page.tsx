import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { listCoursesWithStatus } from '@/lib/db/course-profile-queries';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

function StatusBadge({ profileExists, manuallyEdited, materialCount }: {
  profileExists: boolean;
  manuallyEdited: boolean;
  materialCount: number;
}) {
  if (profileExists && manuallyEdited) {
    return <Badge variant="default">Profile (edited)</Badge>;
  }
  if (profileExists) {
    return <Badge variant="secondary">Profile ready</Badge>;
  }
  if (materialCount > 0) {
    return (
      <Badge variant="outline">
        {materialCount} file{materialCount === 1 ? '' : 's'}, not analyzed
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-muted-foreground">No materials</Badge>;
}

export default async function CoursesIndexPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isValidSlug(slug)) notFound();

  const courses = await listCoursesWithStatus();

  return (
    <main className="mx-auto max-w-4xl p-6 md:p-12 space-y-8">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link href={`/preview/${slug}`} className="underline underline-offset-2 hover:text-foreground">
          &larr; Back to prototype
        </Link>
      </div>

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Courses</h1>
        <p className="text-muted-foreground leading-relaxed max-w-2xl">
          Upload assignment materials per course, analyze them to build an evidence-grounded profile,
          and curate the profile here. Courses with a profile feed richer context to the analyze routes.
        </p>
      </header>

      <div className="space-y-3">
        {courses.map((c) => (
          <div
            key={c.code}
            className="rounded-lg border bg-card p-4 flex items-center justify-between gap-4"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{c.code}</span>
                <span className="text-xs text-muted-foreground">{c.track} · Level {c.level}</span>
              </div>
              <p className="text-sm text-muted-foreground truncate">{c.title}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <StatusBadge
                profileExists={c.profileExists}
                manuallyEdited={c.manuallyEdited}
                materialCount={c.materialCount}
              />
              <Link
                href={`/preview/${slug}/courses/${encodeURIComponent(c.code)}`}
                className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Open
              </Link>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
