import type { SynthesisResult } from '@/lib/ai/synthesis/schema';

interface Props {
  result: SynthesisResult;
}

export function SynthesizedInsightsPanel({ result }: Props) {
  return (
    <section className="space-y-6 rounded-lg border border-slate-200 bg-white p-6">
      <header>
        <h2 className="text-lg font-semibold">Synthesized insights</h2>
        <p className="text-sm text-slate-500">
          Aggregated across partner submissions. Higher-weighted partners influenced these themes more.
        </p>
      </header>

      <Group title="Aggregated job titles">
        {result.aggregatedJobTitles.length === 0 ? (
          <Empty>No titles yet.</Empty>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {result.aggregatedJobTitles.map(t => (
              <li key={t.title} className="rounded bg-slate-100 px-2 py-1 text-sm text-slate-700">
                {t.title} <span className="text-slate-400">×{t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="Responsibility themes">
        {result.responsibilityThemes.length === 0 ? (
          <Empty>No themes synthesized.</Empty>
        ) : (
          <ul className="space-y-3">
            {result.responsibilityThemes.map((t, i) => (
              <li key={i} className="border-l-2 border-slate-200 pl-3">
                <div className="font-medium">{t.theme}</div>
                {t.quotedFrom.length > 0 && (
                  <ul className="mt-1 space-y-1 text-sm text-slate-600">
                    {t.quotedFrom.map((q, j) => (
                      <li key={j}>
                        <span className="italic">&ldquo;{q.snippet}&rdquo;</span>{' '}
                        <span className="text-xs text-slate-400">— {q.partnerId}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Group>

      <div className="grid gap-6 sm:grid-cols-2">
        <Group title="Common required skills">
          {result.commonRequiredSkills.length === 0 ? <Empty>—</Empty> : (
            <ul className="flex flex-wrap gap-2">
              {result.commonRequiredSkills.map(s => (
                <li key={s.skill} className="rounded bg-slate-100 px-2 py-1 text-sm">
                  {s.skill} <span className="text-slate-400">×{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Group>
        <Group title="Common nice-to-haves">
          {result.commonNiceToHaveSkills.length === 0 ? <Empty>—</Empty> : (
            <ul className="flex flex-wrap gap-2">
              {result.commonNiceToHaveSkills.map(s => (
                <li key={s.skill} className="rounded bg-slate-50 px-2 py-1 text-sm text-slate-700">
                  {s.skill} <span className="text-slate-400">×{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Group>
      </div>

      <Group title="Interview question themes">
        {result.interviewQuestionThemes.length === 0 ? <Empty>—</Empty> : (
          <ul className="space-y-3">
            {result.interviewQuestionThemes.map((t, i) => (
              <li key={i} className="border-l-2 border-slate-200 pl-3">
                <div className="font-medium">{t.theme}</div>
                {t.examples.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-sm text-slate-600">
                    {t.examples.map((q, j) => <li key={j}>{q}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Group>

      {result.sampleQuotes.length > 0 && (
        <Group title="Sample partner voice">
          <ul className="space-y-2">
            {result.sampleQuotes.map((q, i) => (
              <li key={i} className="rounded bg-slate-50 p-3 text-sm">
                <span className="italic">&ldquo;{q.quote}&rdquo;</span>{' '}
                <span className="text-xs text-slate-500">— {q.partnerId}</span>
              </li>
            ))}
          </ul>
        </Group>
      )}
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400">{children}</p>;
}
