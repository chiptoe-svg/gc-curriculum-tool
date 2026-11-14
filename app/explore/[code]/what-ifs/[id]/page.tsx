import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { isValidSlug } from '@/lib/slug';
import { getRequestGrant } from '@/lib/auth/viewer';
import { getLatestSnapshotByCourse, getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { getWhatIf, listWhatIfAttachments } from '@/lib/db/what-if-queries';
import { canReadWhatIf, canManageWhatIf } from '@/lib/what-if/ownership';
import { WhatIfPageLayout, type WhatIfBase } from './WhatIfPageLayout';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  params: Promise<{ code: string; id: string }>;
  searchParams: Promise<{ slug?: string }>;
}

// The what-if page: faculty-only, never written to the wiki repository. Readable by anyone
// signed in once it has a page; the author or an admin also gets the actions.
export default async function WhatIfPage({ params, searchParams }: Props) {
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
  // Not found rather than forbidden when the caller cannot read it: existence is not revealed.
  if (!whatIf || whatIf.courseCode !== code || !canReadWhatIf(grant, whatIf)) notFound();
  const canManage = canManageWhatIf(grant, whatIf);

  const { estimate, profile, knockOn, prose, pageCreatedAt } = whatIf;
  if (!pageCreatedAt || !estimate || !profile || !knockOn || !prose) {
    // No page yet (only its author or an admin can get here): the conversation is where it is made.
    redirect(`/explore/${encodeURIComponent(code)}/what-ifs/${id}/talk?slug=${encodeURIComponent(slug)}`);
  }

  // Withdrawn = the snapshot's retiredAt is set; gone = the snapshot row was deleted (base id is null).
  const baseSnapshot = whatIf.baseSnapshotId ? await getSnapshotById(whatIf.baseSnapshotId) : null;
  let base: WhatIfBase;
  if (!baseSnapshot) {
    base = { state: 'gone', approvedBy: null, approvedAt: null };
  } else {
    const latest = baseSnapshot.retiredAt ? null : await getLatestSnapshotByCourse(code);
    base = {
      state: baseSnapshot.retiredAt ? 'withdrawn' : latest && latest.id !== baseSnapshot.id ? 'newer' : 'ok',
      approvedBy: baseSnapshot.instructorName,
      approvedAt: baseSnapshot.createdAt.toISOString(),
    };
  }

  const attachments = (await listWhatIfAttachments(id)).map(a => ({ fileName: a.fileName, status: a.status }));

  return (
    <WhatIfPageLayout
      view={{
        id,
        courseCode: whatIf.courseCode,
        title: whatIf.title,
        authorName: whatIf.authorName,
        pageCreatedAt: pageCreatedAt.toISOString(),
        estimate, profile, knockOn, prose,
        attachments,
      }}
      base={base}
      canManage={canManage}
      slug={slug}
    />
  );
}
