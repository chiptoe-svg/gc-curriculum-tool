import { notFound } from 'next/navigation';
import { findPartnerByToken } from '@/lib/partners/queries';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { getEmployerSession, getLatestEmployerSessionId, getLatestCaptureFor } from '@/lib/db/employer-capture-queries';
import { InterviewPanel } from './InterviewPanel';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ token: string; targetId: string }>;
}

export default async function PartnerInterviewPage({ params }: Props) {
  const { token, targetId } = await params;

  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) notFound();

  const target = await getTargetById(targetId);
  if (!target) notFound();

  const sessionId = await getLatestEmployerSessionId(partner.id, targetId);
  const initialMessages = sessionId
    ? await getEmployerSession(partner.id, targetId, sessionId)
    : [];

  const existingCapture = await getLatestCaptureFor(partner.id, targetId);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">CareerCapture interview</p>
        <h1 className="mt-1 text-2xl font-semibold">{target.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{target.shortDefinition}</p>
      </header>

      {existingCapture && (
        <div className="mb-6 rounded-md border border-stone-300 bg-stone-50 px-4 py-3 text-sm">
          <p className="font-semibold">A prior capture exists for this target ({new Date(existingCapture.createdAt).toLocaleDateString()}).</p>
          <p className="mt-1 text-xs text-muted-foreground">Starting a new interview adds a new capture; the prior one stays as history.</p>
        </div>
      )}

      <InterviewPanel
        token={token}
        targetId={targetId}
        targetName={target.name}
        initialSessionId={sessionId}
        initialMessages={initialMessages.map(m => ({
          role: m.role,
          content: m.content ?? '',
        }))}
      />
    </div>
  );
}
