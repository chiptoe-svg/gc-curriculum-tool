import Link from 'next/link';

interface Props {
  partner: { firstName: string; company: string };
  token: string;
}

export function WelcomeScreen({ partner, token }: Props) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-slate-500">Hi {partner.firstName} — thanks for being here.</p>
        <h1 className="mt-1 text-3xl font-semibold">Help us shape what GC graduates can do.</h1>
        <p className="mt-3 max-w-2xl text-slate-700">
          We&apos;re updating the career targets the Clemson Graphic Communications curriculum builds toward.
          Your input shapes what we teach. About 10 minutes per position you describe, plus an optional 5 minutes
          rating the kinds of projects you&apos;d want grads to have done. You can come back anytime through the same link.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href={`/partners/${encodeURIComponent(token)}/submit`}
          className="block rounded-lg border border-slate-200 bg-white p-6 hover:border-slate-400"
        >
          <div className="text-lg font-medium">Describe a position you hire for</div>
          <p className="mt-2 text-sm text-slate-600">
            Pick the closest match from our career targets, then tell us about the actual role.
          </p>
        </Link>

        <div className="block rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-slate-500">
          <div className="text-lg font-medium">Rate student projects</div>
          <p className="mt-2 text-sm">Coming soon — second part of the survey.</p>
        </div>
      </div>
    </div>
  );
}
