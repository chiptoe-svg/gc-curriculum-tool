import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getRequestGrant } from '@/lib/auth/viewer';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getWhatIf, listWhatIfAttachments } from '@/lib/db/what-if-queries';
import { canManageWhatIf } from '@/lib/what-if/ownership';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';
import { FeedbackLink } from '@/app/FeedbackLink';
import { WhatIfChatPanel } from './WhatIfChatPanel';
import { DeleteWhatIf } from '../DeleteWhatIf';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  params: Promise<{ code: string; id: string }>;
  searchParams: Promise<{ slug?: string }>;
}

// The what-if conversation: private to the author (or an admin).
export default async function WhatIfTalkPage({ params, searchParams }: Props) {
  const { code: rawCode, id } = await params;
  const { slug = '' } = await searchParams;
  const code = decodeURIComponent(rawCode);

  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">
          Open this page through the access link your administrator shared.
        </p>
      </div>
    );
  }

  if (!UUID.test(id)) notFound();
  const grant = await getRequestGrant(await headers());
  if (!grant) notFound();
  const whatIf = await getWhatIf(id);
  if (!whatIf || whatIf.courseCode !== code || !canManageWhatIf(grant, whatIf)) notFound();
  if (whatIf.skills && !whatIf.profile) redirect(`/explore/${encodeURIComponent(code)}/what-ifs/${id}?slug=${encodeURIComponent(slug)}`);
  const course = await getCourseByCode(code);
  if (!course) notFound();

  const q = `?slug=${encodeURIComponent(slug)}`;
  const attachments = (await listWhatIfAttachments(id)).map(a => ({
    id: a.id, fileName: a.fileName, status: a.status, heldBackReason: a.heldBackReason,
  }));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">What-if · {course.code}</p>
            <h1 className="mt-0.5 text-xl font-semibold">{whatIf.title ?? WHAT_IF_COPY.untitled}</h1>
            <p className="mt-1 text-sm font-medium">{WHAT_IF_COPY.banner}</p>
          </div>
          <div className="flex items-center gap-4">
            {whatIf.pageCreatedAt && (
              <Link href={`/explore/${encodeURIComponent(code)}/what-ifs/${id}${q}`} className="text-sm text-muted-foreground hover:text-foreground">
                View the page
              </Link>
            )}
            <Link href={`/explore/${encodeURIComponent(code)}${q}`} className="text-sm text-muted-foreground hover:text-foreground">
              {WHAT_IF_COPY.listLink}
            </Link>
            <FeedbackLink />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-6">
        <WhatIfChatPanel
          courseCode={code}
          whatIfId={id}
          slug={slug}
          hasPage={whatIf.pageCreatedAt !== null}
          initialAttachments={attachments}
        />
        <div className="mt-6 border-t pt-4">
          <DeleteWhatIf courseCode={code} whatIfId={id} slug={slug} />
        </div>
      </main>
    </div>
  );
}
