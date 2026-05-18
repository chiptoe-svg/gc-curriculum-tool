'use client';

import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface CourseDetailFields {
  description: string;
  prerequisites: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

interface Props {
  original: CourseDetailFields;     // last fetched from the sheet
  current: CourseDetailFields;      // current editable state
  onChange: (next: CourseDetailFields) => void;
  onReset: () => void;
}

function lines(arr: string[]): string { return arr.join('\n'); }
function toArr(s: string): string[] { return s.split('\n').map(x => x.trim()).filter(Boolean); }

function fieldEdited<T>(a: T, b: T): boolean { return JSON.stringify(a) !== JSON.stringify(b); }

export function CourseDetails({ original, current, onChange, onReset }: Props) {
  const anyEdited =
    current.description !== original.description ||
    current.prerequisites !== original.prerequisites ||
    fieldEdited(current.learningObjectives, original.learningObjectives) ||
    fieldEdited(current.majorProjects, original.majorProjects) ||
    fieldEdited(current.skillsRequired, original.skillsRequired);

  function EditedBadge({ shown }: { shown: boolean }) {
    return shown ? <Badge variant="secondary" className="ml-2">Edited</Badge> : null;
  }

  return (
    <div className="space-y-4">
      {anyEdited && (
        <div className="flex justify-end">
          <button type="button" onClick={onReset} className="text-xs underline text-muted-foreground hover:text-foreground">
            Reset all fields to sheet version
          </button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center">
          <Label htmlFor="course-description">Description</Label>
          <EditedBadge shown={current.description !== original.description} />
        </div>
        <Textarea
          id="course-description" rows={4}
          value={current.description}
          onChange={(e) => onChange({ ...current, description: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center">
          <Label htmlFor="course-prereqs">Prerequisites</Label>
          <EditedBadge shown={current.prerequisites !== original.prerequisites} />
        </div>
        <Textarea
          id="course-prereqs" rows={2}
          value={current.prerequisites}
          onChange={(e) => onChange({ ...current, prerequisites: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center">
          <Label htmlFor="course-objectives">Learning Objectives <span className="text-xs text-muted-foreground">(one per line)</span></Label>
          <EditedBadge shown={fieldEdited(current.learningObjectives, original.learningObjectives)} />
        </div>
        <Textarea
          id="course-objectives" rows={6}
          value={lines(current.learningObjectives)}
          onChange={(e) => onChange({ ...current, learningObjectives: toArr(e.target.value) })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center">
          <Label htmlFor="course-projects">Major Projects <span className="text-xs text-muted-foreground">(one per line)</span></Label>
          <EditedBadge shown={fieldEdited(current.majorProjects, original.majorProjects)} />
        </div>
        <Textarea
          id="course-projects" rows={5}
          value={lines(current.majorProjects)}
          onChange={(e) => onChange({ ...current, majorProjects: toArr(e.target.value) })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center">
          <Label htmlFor="course-skills">Skills / Competencies Required <span className="text-xs text-muted-foreground">(one per line)</span></Label>
          <EditedBadge shown={fieldEdited(current.skillsRequired, original.skillsRequired)} />
        </div>
        <Textarea
          id="course-skills" rows={5}
          value={lines(current.skillsRequired)}
          onChange={(e) => onChange({ ...current, skillsRequired: toArr(e.target.value) })}
        />
      </div>
    </div>
  );
}
