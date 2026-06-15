import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getGrantByToken, isGrantValid } from '@/lib/sandbox/grants';
import { lookupScopedSession, SCOPED_SESSION_COOKIE } from '@/lib/sandbox/sessions';

export default async function SandboxEntry({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const grant = await getGrantByToken(token);
  if (!grant || !isGrantValid(grant)) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">This link is no longer valid</h1>
        <p className="mt-3 text-muted-foreground">Ask your contact for a fresh access link.</p>
      </div>
    );
  }
  const sid = (await cookies()).get(SCOPED_SESSION_COOKIE)?.value;
  if (sid) {
    const sess = await lookupScopedSession(sid);
    if (sess && sess.courseCode === grant.courseCode) redirect(`/capture/${encodeURIComponent(grant.courseCode)}`);
  }
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Welcome — let's capture your course</h1>
      <p className="mt-3 text-muted-foreground">Tell us who you are; this labels the captured profile.</p>
      <form method="POST" action={`/sandbox/${encodeURIComponent(token)}/start`} className="mt-6 space-y-4">
        <input name="name" required placeholder="Your name" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <input name="institution" placeholder="Institution (optional)" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Start →</button>
      </form>
    </div>
  );
}
