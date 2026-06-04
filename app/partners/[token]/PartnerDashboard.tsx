import Link from 'next/link';
import { SubmissionsList } from './submit/SubmissionsList';

interface TargetOption {
  id: string;
  name: string;
}

interface Props {
  partner: { firstName: string; company: string };
  stats: { drafts: number; submitted: number; ratingsCount: number };
  token: string;
  targets: TargetOption[];
}

export function PartnerDashboard({ partner, stats, token, targets }: Props) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-slate-500">Welcome back, {partner.firstName} ({partner.company}).</p>
        <h1 className="mt-1 text-2xl font-semibold">Your survey</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          title="Positions"
          metric={`${stats.submitted} submitted${stats.drafts ? ` · ${stats.drafts} draft` : ''}`}
          cta="Add another position"
          href={`/partners/${encodeURIComponent(token)}/submit`}
        />
        <Card
          title="Project ratings"
          metric={`${stats.ratingsCount} rated`}
          cta="Rate more projects"
          href="#"
          disabled
        />
        <Card title="" metric="" cta="I'm done for now" href={`/partners/${encodeURIComponent(token)}/done`} subtle />
      </div>

      {targets.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">Career-target interviews</h2>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {targets.map(target => (
              <div key={target.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium">{target.name}</span>
                <Link
                  href={`/partners/${encodeURIComponent(token)}/interview/${encodeURIComponent(target.id)}`}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
                >
                  Start interview
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">Your submissions</h2>
        <SubmissionsList token={token} />
      </section>
    </div>
  );
}

function Card({ title, metric, cta, href, disabled, subtle }: {
  title: string; metric: string; cta: string; href: string; disabled?: boolean; subtle?: boolean;
}) {
  const base = 'block rounded-lg border p-5';
  const tone = subtle
    ? 'border-dashed border-slate-300 bg-slate-50 text-slate-600'
    : 'border-slate-200 bg-white hover:border-slate-400';
  const inner = (
    <>
      {title && <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>}
      {metric && <div className="mt-1 text-lg font-medium">{metric}</div>}
      <div className={`mt-3 text-sm ${subtle ? '' : 'text-blue-700'}`}>{cta} →</div>
    </>
  );
  if (disabled) return <div className={`${base} ${tone} opacity-60`}>{inner}</div>;
  return <Link href={href} className={`${base} ${tone}`}>{inner}</Link>;
}
