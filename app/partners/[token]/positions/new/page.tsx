import { notFound } from 'next/navigation';
import { findPartnerByToken } from '@/lib/partners/queries';
import { listTargets } from '@/lib/db/career-targets-queries';
import { TargetPicker } from './TargetPicker';

interface Props { params: Promise<{ token: string }> }

export const dynamic = 'force-dynamic';

export default async function NewPositionPage({ params }: Props) {
  const { token } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) notFound();
  const targets = await listTargets();
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Position Capture</p>
        <h1 className="mt-1 text-2xl font-semibold">Which career path is this position closest to?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick the closest match — you'll describe the actual position in the next steps. If none fit
          well, pick the closest and you can note that mismatch in the form.
        </p>
      </header>
      <TargetPicker
        token={token}
        targets={targets.map(t => ({ id: t.id, name: t.name, shortDefinition: t.shortDefinition ?? '' }))}
      />
    </div>
  );
}
