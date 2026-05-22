'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CourseSelector } from './CourseSelector';
import { CourseDetails, type CourseDetailFields } from './CourseDetails';
import { formatCourseSyllabus } from '@/lib/courses/formatCourseSyllabus';

const MAX_PRIOR_COURSES = 8;

export interface CourseInput {
  courseLabel: string;
  syllabusText: string;
}

export interface AnalyzeInput {
  course: CourseInput;
  priorCoursework: CourseInput[];
}

interface CourseFullData {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
  prerequisites: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

interface GcSlot {
  mode: 'gc';
  selectedCode: string;
  original: CourseFullData | null;
  current: CourseFullData | null;
}

interface ExternalSlot {
  mode: 'external';
  label: string;
  syllabusText: string | null;
  fileName: string | null;
  extracting: boolean;
  extractError: string | null;
}

type PriorSlot = GcSlot | ExternalSlot;

interface Props {
  slug: string;
  onAnalyze: (input: AnalyzeInput) => void;
  isAnalyzing: boolean;
}

// API response shape from /api/courses/[code] mirrors the Drizzle row.
interface CourseApiResponse {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string | null;
  prerequisites: string | null;
  syllabusUrl: string | null;
  learningObjectives: string[] | null;
  majorProjects: string[] | null;
  skillsRequired: string[] | null;
}

function toCourseFullData(r: CourseApiResponse): CourseFullData {
  return {
    code: r.code,
    title: r.title,
    level: r.level,
    track: r.track,
    description: r.description ?? '',
    prerequisites: r.prerequisites ?? '',
    learningObjectives: r.learningObjectives ?? [],
    majorProjects: r.majorProjects ?? [],
    skillsRequired: r.skillsRequired ?? [],
  };
}

function emptyGcSlot(): GcSlot {
  return { mode: 'gc', selectedCode: '', original: null, current: null };
}

function emptyExternalSlot(): ExternalSlot {
  return { mode: 'external', label: '', syllabusText: null, fileName: null, extracting: false, extractError: null };
}

function isSlotReady(slot: PriorSlot): boolean {
  if (slot.mode === 'gc') return slot.current !== null;
  return slot.label.trim().length > 0 && slot.syllabusText !== null;
}

function ExternalSlotUI({
  slot,
  slug,
  onUpdate,
}: {
  slot: ExternalSlot;
  slug: string;
  onUpdate: (next: ExternalSlot) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    onUpdate({ ...slot, extracting: true, extractError: null, syllabusText: null, fileName: null });

    const form = new FormData();
    form.set('slug', slug);
    form.set('file', file);

    try {
      const res = await fetch('/api/extract-syllabus', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) {
        onUpdate({ ...slot, extracting: false, extractError: (json as { error?: string }).error ?? `Failed (${res.status})` });
        return;
      }
      onUpdate({ ...slot, extracting: false, syllabusText: (json as { text: string }).text, fileName: file.name, extractError: null });
    } catch {
      onUpdate({ ...slot, extracting: false, extractError: 'Failed to extract text. Try a different file.' });
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Course label (e.g. &quot;ENGL 101 — Composition&quot;)</label>
        <input
          type="text"
          value={slot.label}
          onChange={(e) => onUpdate({ ...slot, label: e.target.value })}
          placeholder="Course name or code"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Syllabus (PDF or DOCX)</label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={slot.extracting}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            {slot.extracting ? 'Extracting…' : 'Attach syllabus'}
          </button>
          {slot.fileName && !slot.extracting && (
            <span className="text-xs text-green-700">{slot.fileName} — ready</span>
          )}
          {slot.extractError && (
            <span className="text-xs text-destructive">{slot.extractError}</span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
          className="sr-only"
          onChange={handleFile}
        />
      </div>
    </div>
  );
}

export function PrototypeForm({ slug, onAnalyze, isAnalyzing }: Props) {
  const [mainCourse, setMainCourse] = useState<GcSlot>(emptyGcSlot());
  const [priorCoursework, setPriorCoursework] = useState<PriorSlot[]>([emptyGcSlot()]);

  async function fetchCourse(code: string): Promise<CourseFullData | null> {
    try {
      const resp = await fetch(`/api/courses/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`);
      if (!resp.ok) return null;
      const body = (await resp.json()) as CourseApiResponse;
      return toCourseFullData(body);
    } catch {
      return null;
    }
  }

  async function handleSelectCourse(code: string) {
    setMainCourse({ mode: 'gc', selectedCode: code, original: null, current: null });
    const data = await fetchCourse(code);
    if (data) setMainCourse({ mode: 'gc', selectedCode: code, original: data, current: data });
  }

  async function handleSelectPrior(index: number, code: string) {
    setPriorCoursework(prev => prev.map((slot, i) =>
      i === index ? { mode: 'gc' as const, selectedCode: code, original: null, current: null } : slot
    ));
    const data = await fetchCourse(code);
    if (data) {
      setPriorCoursework(prev => prev.map((slot, i) =>
        i === index ? { mode: 'gc' as const, selectedCode: code, original: data, current: data } : slot
      ));
    }
  }

  function handleCourseChange(next: CourseDetailFields) {
    setMainCourse(prev => prev.current ? { ...prev, current: { ...prev.current, ...next } } : prev);
  }

  function handleCourseReset() {
    setMainCourse(prev => prev.original ? { ...prev, current: prev.original } : prev);
  }

  function handlePriorChange(index: number, next: CourseDetailFields) {
    setPriorCoursework(prev => prev.map((slot, i) => {
      if (i !== index || slot.mode !== 'gc' || !slot.current) return slot;
      return { ...slot, current: { ...slot.current, ...next } };
    }));
  }

  function handlePriorReset(index: number) {
    setPriorCoursework(prev => prev.map((slot, i) => {
      if (i !== index || slot.mode !== 'gc' || !slot.original) return slot;
      return { ...slot, current: slot.original };
    }));
  }

  function switchPriorMode(index: number, mode: 'gc' | 'external') {
    setPriorCoursework(prev => prev.map((slot, i) => {
      if (i !== index) return slot;
      return mode === 'gc' ? emptyGcSlot() : emptyExternalSlot();
    }));
  }

  function updateExternalSlot(index: number, next: ExternalSlot) {
    setPriorCoursework(prev => prev.map((slot, i) => i === index ? next : slot));
  }

  function addPriorCourse() {
    if (priorCoursework.length < MAX_PRIOR_COURSES) {
      setPriorCoursework(prev => [...prev, emptyGcSlot()]);
    }
  }

  function removePriorCourse(index: number) {
    if (priorCoursework.length <= 1) return;
    setPriorCoursework(prev => prev.filter((_, i) => i !== index));
  }

  const canSubmit =
    !isAnalyzing &&
    mainCourse.current !== null &&
    priorCoursework.length >= 1 &&
    priorCoursework.every(isSlotReady);

  function handleSubmit() {
    if (!mainCourse.current) return;
    const priors: CourseInput[] = [];
    for (const slot of priorCoursework) {
      if (slot.mode === 'gc') {
        if (!slot.current) return;
        priors.push({ courseLabel: slot.current.code, syllabusText: formatCourseSyllabus(slot.current) });
      } else {
        if (!slot.syllabusText) return;
        priors.push({ courseLabel: slot.label, syllabusText: slot.syllabusText });
      }
    }
    onAnalyze({
      course: { courseLabel: mainCourse.current.code, syllabusText: formatCourseSyllabus(mainCourse.current) },
      priorCoursework: priors,
    });
  }

  return (
    <div className="space-y-6">
      {/* Course being analyzed card */}
      <Card>
        <CardHeader>
          <CardTitle>Course being analyzed</CardTitle>
          <p className="text-sm text-muted-foreground">Only courses approved in the Course Builder are available for selection.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <CourseSelector
            slug={slug}
            selectedCode={mainCourse.selectedCode}
            onSelect={handleSelectCourse}
            label="Course being analyzed (by code)"
            inputId="course-selector"
            requireApproved
          />
          {mainCourse.original && mainCourse.current && (
            <CourseDetails
              original={mainCourse.original}
              current={mainCourse.current}
              onChange={handleCourseChange}
              onReset={handleCourseReset}
            />
          )}
        </CardContent>
      </Card>

      {/* Prior coursework card */}
      <Card>
        <CardHeader>
          <CardTitle>Prior coursework</CardTitle>
          <p className="text-sm text-muted-foreground">
            Any prerequisite or expected prior coursework. Order doesn&apos;t matter. Only approved GC courses or external courses with an attached syllabus are accepted.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {priorCoursework.map((slot, index) => (
            <div key={index} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                {/* Mode toggle */}
                <div className="flex rounded-md border text-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => switchPriorMode(index, 'gc')}
                    className={`px-3 py-1 ${slot.mode === 'gc' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    GC course
                  </button>
                  <button
                    type="button"
                    onClick={() => switchPriorMode(index, 'external')}
                    className={`px-3 py-1 ${slot.mode === 'external' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    External course
                  </button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => removePriorCourse(index)}
                  disabled={priorCoursework.length <= 1}
                  aria-label={`Remove prior course ${index + 1}`}
                >
                  Remove
                </Button>
              </div>

              {slot.mode === 'gc' ? (
                <>
                  <CourseSelector
                    slug={slug}
                    selectedCode={slot.selectedCode}
                    onSelect={(code) => handleSelectPrior(index, code)}
                    label={`Prior course ${index + 1}`}
                    excludeCode={mainCourse.selectedCode || undefined}
                    inputId={`prior-selector-${index}`}
                    requireApproved
                  />
                  {slot.original && slot.current && (
                    <CourseDetails
                      original={slot.original}
                      current={slot.current}
                      onChange={(next) => handlePriorChange(index, next)}
                      onReset={() => handlePriorReset(index)}
                    />
                  )}
                </>
              ) : (
                <ExternalSlotUI
                  slot={slot}
                  slug={slug}
                  onUpdate={(next) => updateExternalSlot(index, next)}
                />
              )}
            </div>
          ))}

          <Button
            variant="outline"
            type="button"
            onClick={addPriorCourse}
            disabled={priorCoursework.length >= MAX_PRIOR_COURSES}
          >
            + Add prior course
          </Button>
        </CardContent>
      </Card>

      <Button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full"
      >
        {isAnalyzing ? 'Analyzing…' : 'Analyze prerequisite alignment'}
      </Button>
    </div>
  );
}
