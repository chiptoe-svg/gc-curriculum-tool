'use client';

import { useState } from 'react';

interface Props {
  courseCode: string;
  slug: string;
  initialObjectives: string[];
  initialProjects: string[];
  initialSkills: string[];
  builderStatus: string;
  onSaved: (newStatus: string) => void;
}

function EditableList({
  label,
  description,
  items,
  onChange,
}: {
  label: string;
  description: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  function update(i: number, value: string) {
    const next = [...items];
    next[i] = value;
    onChange(next);
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...items, '']);
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="text"
              value={item}
              onChange={(e) => update(i, e.target.value)}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-muted-foreground hover:text-destructive text-sm px-2"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
      >
        + Add item
      </button>
    </div>
  );
}

export function BuilderProfileTab({
  courseCode,
  slug,
  initialObjectives,
  initialProjects,
  initialSkills,
  builderStatus,
  onSaved,
}: Props) {
  const [objectives, setObjectives] = useState<string[]>(initialObjectives);
  const [projects, setProjects] = useState<string[]>(initialProjects);
  const [skills, setSkills] = useState<string[]>(initialSkills);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const wasApproved = builderStatus === 'approved' || builderStatus === 'kuds_generated';

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/profile?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            learningObjectives: objectives.filter(Boolean),
            majorProjects: projects.filter(Boolean),
            skillsRequired: skills.filter(Boolean),
          }),
        },
      );
      if (!res.ok) throw new Error('Save failed');
      setSaved(true);
      const allHaveContent =
        objectives.some(Boolean) && projects.some(Boolean) && skills.some(Boolean);
      onSaved(allHaveContent ? 'profile_complete' : builderStatus);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {wasApproved && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Saving profile changes will reset your KUD approval — you will need to regenerate and re-accept KUDs.
        </div>
      )}

      <EditableList
        label="Learning objectives"
        description="What students will achieve — pre-populated from catalog, edit to match reality."
        items={objectives}
        onChange={setObjectives}
      />

      <EditableList
        label="Major projects"
        description="Highest-stakes assignments. First item carries the most weight in KUD generation."
        items={projects}
        onChange={setProjects}
      />

      <EditableList
        label="Required incoming skills"
        description="What students need to arrive knowing — the course's own prereq statement."
        items={skills}
        onChange={setSkills}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      <p className="text-xs text-muted-foreground">
        After saving, go to the KUDs tab to generate outcomes from this profile.
      </p>
    </div>
  );
}
