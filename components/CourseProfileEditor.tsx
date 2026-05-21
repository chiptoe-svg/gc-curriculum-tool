'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Evidence {
  fileName: string;
  quote: string;
}

interface Competency {
  name: string;
  description: string;
  level: string;
  evidence: Evidence[];
}

interface CatalogDivergence {
  reinforced: string[];
  additions: string[];
  gaps: string[];
}

export interface CourseProfileData {
  summary: string;
  learningObjectives: string[];
  skills: string[];
  competencies: Competency[];
  catalogDivergence: CatalogDivergence | null;
}

interface Props {
  courseCode: string;
  slug: string;
  profile: CourseProfileData;
}

// ── StringListEditor ──────────────────────────────────────────────────────────

function StringListEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  function update(index: number, value: string) {
    const next = [...items];
    next[index] = value;
    onChange(next);
  }

  function add() {
    onChange([...items, '']);
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Input
              value={item}
              placeholder={placeholder}
              onChange={(e) => update(i, e.target.value)}
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-xs text-muted-foreground hover:text-destructive shrink-0"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="text-xs text-primary hover:underline"
      >
        + Add
      </button>
    </div>
  );
}

// ── CompetencyEditor ──────────────────────────────────────────────────────────

function CompetencyEditor({
  competencies,
  onChange,
}: {
  competencies: Competency[];
  onChange: (competencies: Competency[]) => void;
}) {
  function updateField(index: number, field: keyof Omit<Competency, 'evidence'>, value: string) {
    const next = competencies.map((c, i) => (i === index ? { ...c, [field]: value } : c));
    onChange(next);
  }

  function remove(index: number) {
    onChange(competencies.filter((_, i) => i !== index));
  }

  function add() {
    onChange([
      ...competencies,
      { name: '', description: '', level: '', evidence: [] },
    ]);
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Competencies</Label>
      <div className="space-y-3">
        {competencies.map((c, i) => (
          <div key={i} className="rounded-md border p-4 space-y-2">
            <div className="flex gap-2 items-start">
              <div className="flex-1 space-y-2">
                <Input
                  value={c.name}
                  placeholder="Competency name"
                  onChange={(e) => updateField(i, 'name', e.target.value)}
                />
                <Input
                  value={c.description}
                  placeholder="Description"
                  onChange={(e) => updateField(i, 'description', e.target.value)}
                />
                <Input
                  value={c.level}
                  placeholder="Level (e.g. introduced, developed, mastered)"
                  onChange={(e) => updateField(i, 'level', e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-xs text-muted-foreground hover:text-destructive shrink-0"
              >
                Remove
              </button>
            </div>
            {c.evidence.length > 0 && (
              <div className="space-y-1 mt-1">
                <p className="text-xs text-muted-foreground font-medium">Evidence</p>
                {c.evidence.map((ev, j) => (
                  <div key={j} className="border-l-2 border-muted pl-3 space-y-0.5">
                    <p className="text-xs italic text-muted-foreground">{ev.quote}</p>
                    <p className="text-xs text-muted-foreground/60">— {ev.fileName}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="text-xs text-primary hover:underline"
      >
        + Add
      </button>
    </div>
  );
}

// ── CatalogDivergencePanel ────────────────────────────────────────────────────

function CatalogDivergencePanel({ divergence }: { divergence: CatalogDivergence | null }) {
  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-2">
      <p className="text-sm font-medium">Catalog divergence</p>
      {divergence === null ? (
        <p className="text-xs text-muted-foreground">No divergence data</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <DivergenceColumn label="Reinforced" items={divergence.reinforced} accent="green" />
          <DivergenceColumn label="Additions" items={divergence.additions} accent="blue" />
          <DivergenceColumn label="Gaps" items={divergence.gaps} accent="amber" />
        </div>
      )}
    </div>
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

// ── CourseProfileEditor ───────────────────────────────────────────────────────

export function CourseProfileEditor({ courseCode, slug, profile }: Props) {
  const [summary, setSummary] = useState(profile.summary);
  const [learningObjectives, setLearningObjectives] = useState<string[]>(
    profile.learningObjectives
  );
  const [skills, setSkills] = useState<string[]>(profile.skills);
  const [competencies, setCompetencies] = useState<Competency[]>(profile.competencies);
  const [toast, setToast] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const url = `/api/courses/${encodeURIComponent(courseCode)}/profile?slug=${slug}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary, learningObjectives, skills, competencies }),
      });

      if (res.ok) {
        setToast('Saved');
      } else {
        let message = 'unknown error';
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // ignore
        }
        setToast(`Save failed: ${message}`);
      }
    });
  }

  return (
    <section className="space-y-6 rounded-lg border bg-card p-5">
      <h2 className="text-base font-semibold">Edit Profile</h2>

      {/* Summary */}
      <div className="space-y-1.5">
        <Label htmlFor="summary" className="text-sm font-medium">
          Summary
        </Label>
        <Textarea
          id="summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
        />
      </div>

      {/* Learning Objectives */}
      <StringListEditor
        label="Learning Objectives"
        items={learningObjectives}
        onChange={setLearningObjectives}
        placeholder="Learning objective"
      />

      {/* Skills */}
      <StringListEditor
        label="Skills"
        items={skills}
        onChange={setSkills}
        placeholder="Skill"
      />

      {/* Competencies */}
      <CompetencyEditor competencies={competencies} onChange={setCompetencies} />

      {/* Catalog Divergence (read-only) */}
      <CatalogDivergencePanel divergence={profile.catalogDivergence} />

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? 'Saving…' : 'Save'}
        </Button>
        {toast && (
          <p className="text-sm text-muted-foreground">{toast}</p>
        )}
      </div>
    </section>
  );
}
