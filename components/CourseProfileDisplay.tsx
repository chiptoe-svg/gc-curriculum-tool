import type { CourseProfileResult } from '@/lib/ai/course-profile/schema';

interface Props {
  profile: CourseProfileResult | null;
}

export function CourseProfileDisplay({ profile }: Props) {
  if (!profile) {
    return (
      <section className="rounded-lg border bg-card p-5 space-y-2">
        <h2 className="text-base font-semibold">Profile</h2>
        <p className="text-sm text-muted-foreground">No profile yet — analyze materials to generate one.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border bg-card p-5 space-y-6">
      <h2 className="text-base font-semibold">Profile</h2>

      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Summary</h3>
        <p className="text-sm leading-relaxed">{profile.summary}</p>
      </div>

      {profile.learningObjectives.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Learning Objectives
          </h3>
          <ul className="space-y-1 text-sm list-disc list-inside">
            {profile.learningObjectives.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      )}

      {profile.skills.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Skills</h3>
          <div className="flex flex-wrap gap-1.5">
            {profile.skills.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {profile.competencies.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Competencies
          </h3>
          <div className="space-y-4">
            {profile.competencies.map((c, i) => (
              <div key={i} className="rounded-md border p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold">{c.name}</h4>
                  <span className="shrink-0 text-xs text-muted-foreground rounded-full border px-2 py-0.5">
                    {c.level}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{c.description}</p>
                {c.evidence.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {c.evidence.map((ev, j) => (
                      <blockquote
                        key={j}
                        className="border-l-2 border-muted pl-3 text-xs text-muted-foreground italic"
                      >
                        &ldquo;{ev.quote}&rdquo;
                        <span className="not-italic ml-1 text-muted-foreground/60">— {ev.fileName}</span>
                      </blockquote>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-md border bg-muted/30 p-4">
        <h3 className="text-sm font-medium">Catalog Divergence</h3>
        <p className="text-xs text-muted-foreground">
          How real assignments compare to what the catalog says this course covers.
        </p>
        <div className="grid gap-3 sm:grid-cols-3 mt-2">
          <DivergenceColumn label="Reinforced" items={profile.catalogDivergence.reinforced} accent="green" />
          <DivergenceColumn label="Additions" items={profile.catalogDivergence.additions} accent="blue" />
          <DivergenceColumn label="Gaps" items={profile.catalogDivergence.gaps} accent="amber" />
        </div>
      </div>
    </section>
  );
}

function DivergenceColumn({
  label,
  items,
  accent,
}: {
  label: string;
  items: string[];
  accent: 'green' | 'blue' | 'amber';
}) {
  const accentClass = {
    green: 'text-green-700 dark:text-green-400',
    blue: 'text-blue-700 dark:text-blue-400',
    amber: 'text-amber-700 dark:text-amber-400',
  }[accent];

  return (
    <div className="space-y-1">
      <p className={`text-xs font-semibold uppercase tracking-wide ${accentClass}`}>{label}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None identified.</p>
      ) : (
        <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
