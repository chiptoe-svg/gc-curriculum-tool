import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { MaterialsZone } from './MaterialsZone';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string; code: string }>;
}

export default async function CourseDetailPage({ params }: Props) {
  const { slug, code } = await params;
  if (!isValidSlug(slug)) notFound();

  const course = await getCourseByCode(code);
  if (!course) notFound();

  const rawMaterials = await listMaterialsByCourse(code);
  const materials = rawMaterials.map((m) => ({
    id: m.id,
    fileName: m.fileName,
    blobUrl: m.blobUrl,
    extractionStatus: m.extractionStatus as 'pending' | 'ok' | 'low_text' | 'failed',
    extractionMethod: m.extractionMethod ?? undefined,
    pageCount: m.pageCount ?? undefined,
  }));

  return (
    <main className="mx-auto max-w-4xl p-6 md:p-12 space-y-8">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link href={`/preview/${slug}`} className="underline underline-offset-2 hover:text-foreground">
          &larr; Back to prototype
        </Link>
      </div>

      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{course.code}</p>
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <p className="text-sm text-muted-foreground">Level {course.level} · {course.track}</p>
      </header>

      {/* Zone 1 — Materials (Plan 1). Zones 2 + 3 added by Plans 2 and 3. */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Assignment Materials</h2>
          <span className="text-xs text-muted-foreground">{materials.length} file{materials.length !== 1 ? 's' : ''}</span>
        </div>

        <MaterialsZone
          courseCode={code}
          slug={slug}
          initialMaterials={materials}
        />
      </section>
    </main>
  );
}
