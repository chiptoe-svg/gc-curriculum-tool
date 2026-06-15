'use client';

import { useState } from 'react';
import type {
  CaptureProjectItem,
  CaptureProfileCitationType,
} from '@/lib/ai/capture/schema';
import { SourceBadge } from './ProfileReviewPanel';

interface MajorProjectsSectionProps {
  majorProjects: CaptureProjectItem[] | null | undefined;
  editable: boolean;
  onChange: (next: CaptureProjectItem[] | null) => void;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
}

function ProjectCard({
  project,
  index,
  editable,
  onChange,
  onRemove,
  onCitationClick,
}: {
  project: CaptureProjectItem;
  index: number;
  editable: boolean;
  onChange: (next: CaptureProjectItem) => void;
  onRemove: () => void;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div className="rounded border bg-background px-3 py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-baseline gap-2 flex-1 min-w-0">
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {index + 1}.
          </span>
          {editable ? (
            <input
              type="text"
              value={project.title}
              onChange={e => onChange({ ...project, title: e.target.value })}
              placeholder="Project title"
              className="flex-1 text-sm font-medium bg-muted/40 rounded-sm px-1 focus:outline-none focus:ring-1 focus:ring-ring border-0"
            />
          ) : (
            <span className="text-sm font-medium">{project.title}</span>
          )}
          <SourceBadge
            source={project.source}
            citations={project.citations}
            onCitationClick={onCitationClick}
          />
        </div>
        {editable && (
          <div className="shrink-0">
            {confirmRemove ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onRemove}
                  className="text-[10px] text-destructive border border-destructive rounded px-1.5 py-0.5 hover:bg-destructive/10"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(false)}
                  className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5 hover:bg-muted"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                className="text-[10px] text-muted-foreground hover:text-foreground border rounded px-1.5 py-0.5"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>

      {/* Description */}
      {editable ? (
        <textarea
          value={project.description}
          onChange={e => onChange({ ...project, description: e.target.value })}
          placeholder="1-3 sentences describing what students produce…"
          rows={2}
          className="w-full resize-none text-xs bg-muted/40 rounded-sm px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring border border-input"
        />
      ) : (
        <p className="text-xs leading-snug">{project.description}</p>
      )}

      {/* Competency tags — read-only (derived from competencies array) */}
      {project.competencies.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide self-center mr-1">
            Develops:
          </span>
          {project.competencies.map((comp, ci) => (
            <span
              key={ci}
              className="inline-flex items-center rounded border bg-muted/60 px-1.5 py-0.5 text-[10px] leading-snug"
              title={comp}
            >
              {comp.length > 60 ? comp.slice(0, 57) + '…' : comp}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function MajorProjectsSection({
  majorProjects,
  editable,
  onChange,
  onCitationClick,
}: MajorProjectsSectionProps) {
  if (!majorProjects) {
    return (
      <section className="rounded-md border bg-card px-4 py-3 text-sm">
        <h3 className="font-semibold text-sm">Major projects</h3>
        <p className="mt-1 text-xs italic text-muted-foreground">
          Not yet captured — re-interview to extract major projects from course materials.
        </p>
      </section>
    );
  }

  function handleProjectChange(i: number, next: CaptureProjectItem) {
    const updated = majorProjects!.slice();
    updated[i] = next;
    onChange(updated);
  }

  function handleRemoveProject(i: number) {
    const next = majorProjects!.filter((_, idx) => idx !== i);
    onChange(next.length > 0 ? next : null);
  }

  function handleAddProject() {
    const blank: CaptureProjectItem = {
      title: '',
      description: '',
      competencies: [],
    };
    onChange([...majorProjects!, blank]);
  }

  return (
    <section className="rounded-md border bg-card px-4 py-3 space-y-3">
      <h3 className="text-sm font-semibold">Major projects</h3>

      {majorProjects.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">(none captured)</p>
      ) : (
        <div className="space-y-2">
          {majorProjects.map((proj, i) => (
            <ProjectCard
              key={i}
              project={proj}
              index={i}
              editable={editable}
              onChange={next => handleProjectChange(i, next)}
              onRemove={() => handleRemoveProject(i)}
              onCitationClick={onCitationClick}
            />
          ))}
        </div>
      )}

      {editable && (
        <button
          type="button"
          onClick={handleAddProject}
          className="text-[11px] text-muted-foreground hover:text-foreground border border-dashed border-muted-foreground/40 rounded px-2 py-0.5"
        >
          + Add project
        </button>
      )}
    </section>
  );
}
