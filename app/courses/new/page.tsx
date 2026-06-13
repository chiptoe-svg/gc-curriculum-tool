import { headers } from 'next/headers';
import { isValidSlug } from '@/lib/slug';
import { resolveRole } from '@/lib/auth/basic-auth';
import { NewCourseForm } from './NewCourseForm';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

/**
 * Focused add-a-course page.  POSTs to the same roster endpoint that
 * CourseRosterControls uses, then redirects into /capture/[code] Step 1.
 */
export default async function NewCoursePage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;

  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">
          Open this page through the access link your administrator shared. The link
          carries the slug query parameter that grants access.
        </p>
      </div>
    );
  }

  const role = resolveRole((await headers()).get('authorization'), {
    faculty: process.env.FACULTY_BASIC_AUTH,
    creator: process.env.CREATE_ONLY_AUTH,
  });
  // Faculty (or no gate configured → null) keep the capture redirect;
  // the create-only role gets the confirmation flow.
  const canCapture = role !== 'creator';

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-2xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">CourseCapture</p>
            <h1 className="mt-0.5 text-xl font-semibold">Add a course</h1>
          </div>
          {/* The LAN landing is the canonical public course list (the faculty
              guide's published entry point); a relative link would keep users
              on the funnel origin. */}
          <a
            href="http://130.127.162.180:3000/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Course List
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <NewCourseForm slug={slug} canCapture={canCapture} />
      </main>
    </div>
  );
}
