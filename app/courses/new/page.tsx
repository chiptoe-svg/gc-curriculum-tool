import { headers } from 'next/headers';
import { isValidSlug } from '@/lib/slug';
import { authorize } from '@/lib/auth/authorize';
import { getRequestGrant } from '@/lib/auth/viewer';
import { NewCourseForm } from './NewCourseForm';

import '../courses.css';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

/**
 * Focused add-a-course page.  POSTs to the same roster endpoint that
 * the roster route uses, then redirects into /capture/[code] Step 1.
 */
export default async function NewCoursePage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;

  if (!isValidSlug(slug)) {
    return (
      <div className="cs-main is-narrow cs-center">
        <h1 className="cs-title">Access link required</h1>
        <p className="cs-meta mt-3">
          Open this page through the access link your administrator shared. The link
          carries the slug query parameter that grants access.
        </p>
      </div>
    );
  }

  // The request's grant, resolved like the gate (spec 2026-10-08 §4). The
  // form is shown only to a grant that may add a course — the same
  // authorize() rule the create API enforces — and fails closed: no grant,
  // no form, whatever env is set.
  const grant = await getRequestGrant(await headers());
  if (!grant || !authorize(grant, 'POST', '/courses/new').ok) {
    return (
      <div className="cs-main is-narrow cs-center">
        <h1 className="cs-title">This link can’t add courses</h1>
        <p className="cs-meta mt-3">
          Open this page with a personal link that is allowed to add courses.
        </p>
      </div>
    );
  }
  // A grant that can also capture keeps the capture redirect; a create-only
  // grant gets the confirmation flow.
  const canCapture = grant.can.includes('capture');

  return (
    <div className="min-h-screen bg-background">
      <header className="cs-header">
        <div className="cs-header-inner is-narrow">
          <div>
            <p className="cs-eyebrow">CourseCapture</p>
            <h1 className="cs-title">Add a course</h1>
          </div>
          {/* The campus HTTPS landing is the canonical public course list (the
              faculty guide's published entry point). Was http://…:3000 while the
              Funnel was the faculty origin; since 2026-09-07 there is one origin
              and cleartext :3000 is being retired, so this points at HTTPS. */}
          <a
            href="https://gcworkflow.clemson.edu:8443/"
            className="cs-btn"
          >
            ← Course List
          </a>
        </div>
      </header>

      <main className="cs-main is-narrow">
        <NewCourseForm slug={slug} canCapture={canCapture} />
      </main>
    </div>
  );
}
