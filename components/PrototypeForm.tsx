'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CourseSelector } from './CourseSelector';
import { CourseDetails } from './CourseDetails';
import { formatCourseSyllabus } from '@/lib/courses/formatCourseSyllabus';

const MAX_PRIOR_COURSES = 8;

interface TargetOption {
  id: string;
  name: string;
}

export interface CourseInput {
  courseLabel: string;
  syllabusText: string;
}

export interface AnalyzeInput {
  careerTargetId: string;
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

interface CourseSlot {
  selectedCode: string;
  original: CourseFullData | null;
  current: CourseFullData | null;
}

interface Props {
  slug: string;
  onAnalyze: (input: AnalyzeInput) => void;
  isAnalyzing: boolean;
}

function emptySlot(): CourseSlot {
  return { selectedCode: '', original: null, current: null };
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

export function PrototypeForm({ slug, onAnalyze, isAnalyzing }: Props) {
  const [targets, setTargets] = useState<TargetOption[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [careerTargetId, setCareerTargetId] = useState('');
  const [course, setCourse] = useState<CourseSlot>(emptySlot());
  const [priorCoursework, setPriorCoursework] = useState<CourseSlot[]>([emptySlot()]);

  useEffect(() => {
    fetch('/api/targets')
      .then((r) => r.json())
      .then((data: TargetOption[]) => {
        setTargets(data);
        if (data.length > 0 && !careerTargetId) {
          setCareerTargetId(data[0]!.id);
        }
      })
      .catch(() => {
        // If fetch fails, leave targets empty — user sees empty dropdown
      })
      .finally(() => setTargetsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setCourse({ selectedCode: code, original: null, current: null });
    const data = await fetchCourse(code);
    if (data) {
      setCourse({ selectedCode: code, original: data, current: data });
    }
  }

  async function handleSelectPrior(index: number, code: string) {
    setPriorCoursework(prev => prev.map((slot, i) =>
      i === index ? { selectedCode: code, original: null, current: null } : slot
    ));
    const data = await fetchCourse(code);
    if (data) {
      setPriorCoursework(prev => prev.map((slot, i) =>
        i === index ? { selectedCode: code, original: data, current: data } : slot
      ));
    }
  }

  function handleCourseChange(next: CourseFullData) {
    setCourse(prev => ({ ...prev, current: next }));
  }

  function handleCourseReset() {
    setCourse(prev => prev.original ? { ...prev, current: prev.original } : prev);
  }

  function handlePriorChange(index: number, next: CourseFullData) {
    setPriorCoursework(prev => prev.map((slot, i) =>
      i === index ? { ...slot, current: next } : slot
    ));
  }

  function handlePriorReset(index: number) {
    setPriorCoursework(prev => prev.map((slot, i) =>
      i === index && slot.original ? { ...slot, current: slot.original } : slot
    ));
  }

  function addPriorCourse() {
    if (priorCoursework.length < MAX_PRIOR_COURSES) {
      setPriorCoursework(prev => [...prev, emptySlot()]);
    }
  }

  function removePriorCourse(index: number) {
    if (priorCoursework.length <= 1) return;
    setPriorCoursework(prev => prev.filter((_, i) => i !== index));
  }

  const canSubmit =
    !isAnalyzing &&
    careerTargetId.length > 0 &&
    course.current !== null &&
    priorCoursework.length >= 1 &&
    priorCoursework.every(p => p.current !== null);

  function handleSubmit() {
    if (!course.current) return;
    const priors: CourseInput[] = [];
    for (const p of priorCoursework) {
      if (!p.current) return;
      priors.push({
        courseLabel: p.current.code,
        syllabusText: formatCourseSyllabus(p.current),
      });
    }
    onAnalyze({
      careerTargetId,
      course: {
        courseLabel: course.current.code,
        syllabusText: formatCourseSyllabus(course.current),
      },
      priorCoursework: priors,
    });
  }

  return (
    <div className="space-y-6">
      {/* Course being analyzed card — appears FIRST */}
      <Card>
        <CardHeader>
          <CardTitle>Course being analyzed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CourseSelector
            slug={slug}
            selectedCode={course.selectedCode}
            onSelect={handleSelectCourse}
            label="Course being analyzed (by code)"
            inputId="course-selector"
          />
          {course.original && course.current && (
            <CourseDetails
              original={course.original}
              current={course.current}
              onChange={handleCourseChange}
              onReset={handleCourseReset}
            />
          )}
        </CardContent>
      </Card>

      {/* Prior coursework card — appears SECOND */}
      <Card>
        <CardHeader>
          <CardTitle>Prior coursework</CardTitle>
          <p className="text-sm text-muted-foreground">Any prerequisite or expected prior coursework. Order doesn&apos;t matter.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {priorCoursework.map((slot, index) => (
            <div key={index} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">Prior course {index + 1}</span>
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
              <CourseSelector
                slug={slug}
                selectedCode={slot.selectedCode}
                onSelect={(code) => handleSelectPrior(index, code)}
                label={`Prior course ${index + 1}`}
                excludeCode={course.selectedCode || undefined}
                inputId={`prior-selector-${index}`}
              />
              {slot.original && slot.current && (
                <CourseDetails
                  original={slot.original}
                  current={slot.current}
                  onChange={(next) => handlePriorChange(index, next)}
                  onReset={() => handlePriorReset(index)}
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
            {priorCoursework.length >= MAX_PRIOR_COURSES
              ? `Maximum ${MAX_PRIOR_COURSES} prior courses`
              : 'Add prior course'}
          </Button>
        </CardContent>
      </Card>

      {/* Career target + submit */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="career-target">Career target</Label>
            {targetsLoading ? (
              <p className="text-sm text-muted-foreground">Loading career targets...</p>
            ) : (
              <Select value={careerTargetId} onValueChange={(v) => { if (v !== null) setCareerTargetId(v); }}>
                <SelectTrigger id="career-target" aria-label="Career target">
                  <SelectValue placeholder="Choose a target" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Button size="lg" onClick={handleSubmit} disabled={!canSubmit}>
            {isAnalyzing ? 'Analyzing…' : 'Analyze'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
