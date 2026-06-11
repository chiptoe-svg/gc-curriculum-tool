'use client';

/**
 * Read-only presentational overview of a course's catalog fields
 * (DESCRIPTION · PREREQUISITES · LEARNING OBJECTIVES · MAJOR PROJECTS ·
 * REQUIRED INCOMING SKILLS). Lifted verbatim from `MaterialsPanel`'s
 * `CatalogSummary` so the three-source Step-1 boxes can reuse it as the
 * Syllabus box's unrolled content (DRY — same markup, same output).
 */
export interface CatalogOverviewProps {
  description: string;
  prerequisites: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

export function CatalogOverview({
  description,
  prerequisites,
  learningObjectives,
  majorProjects,
  skillsRequired,
}: CatalogOverviewProps) {
  function listOrNone(items: string[]) {
    if (items.length === 0) return <p className="text-xs italic text-muted-foreground">(none)</p>;
    return (
      <ol className="list-decimal space-y-0.5 pl-4 text-xs leading-snug">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ol>
    );
  }
  return (
    <div className="space-y-3 rounded-md border bg-card px-4 py-3">
      <header>
        <h3 className="text-sm font-semibold">Catalog (from the course sheet)</h3>
        <p className="text-xs text-muted-foreground">
          Read-only here. Edit objectives/projects/skills in the Course Builder if you want them changed.
        </p>
      </header>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
        <p className="mt-1 text-xs leading-snug">{description || <span className="italic text-muted-foreground">(none)</span>}</p>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Prerequisites</p>
        <p className="mt-1 text-xs leading-snug">{prerequisites || <span className="italic text-muted-foreground">(none listed)</span>}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Learning objectives ({learningObjectives.length})
          </p>
          <div className="mt-1">{listOrNone(learningObjectives)}</div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Major projects ({majorProjects.length})
          </p>
          <div className="mt-1">{listOrNone(majorProjects)}</div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Required incoming skills ({skillsRequired.length})
          </p>
          <div className="mt-1">{listOrNone(skillsRequired)}</div>
        </div>
      </div>
    </div>
  );
}
