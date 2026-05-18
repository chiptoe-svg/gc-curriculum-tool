'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SampleSyllabusButton } from './SampleSyllabusButton';

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

interface Props {
  onAnalyze: (input: AnalyzeInput) => void;
  isAnalyzing: boolean;
}

function isValidCourse(c: CourseInput): boolean {
  return c.courseLabel.trim().length > 0 && c.syllabusText.length >= 50;
}

export function PrototypeForm({ onAnalyze, isAnalyzing }: Props) {
  const [targets, setTargets] = useState<TargetOption[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [careerTargetId, setCareerTargetId] = useState('');
  const [course, setCourse] = useState<CourseInput>({ courseLabel: '', syllabusText: '' });
  const [priorCoursework, setPriorCoursework] = useState<CourseInput[]>([{ courseLabel: '', syllabusText: '' }]);

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

  const canSubmit =
    !isAnalyzing &&
    isValidCourse(course) &&
    priorCoursework.length >= 1 &&
    priorCoursework.every(isValidCourse);

  function addPriorCourse() {
    if (priorCoursework.length < MAX_PRIOR_COURSES) {
      setPriorCoursework(prev => [...prev, { courseLabel: '', syllabusText: '' }]);
    }
  }

  function removePriorCourse(index: number) {
    if (priorCoursework.length <= 1) return;
    setPriorCoursework(prev => prev.filter((_, i) => i !== index));
  }

  function updatePriorCourse(index: number, field: keyof CourseInput, value: string) {
    setPriorCoursework(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  }

  function handleSubmit() {
    onAnalyze({ careerTargetId, course, priorCoursework });
  }

  return (
    <div className="space-y-6">
      {/* Course being analyzed card — appears FIRST */}
      <Card>
        <CardHeader>
          <CardTitle>Course being analyzed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="course-label">Course label</Label>
            <Input
              id="course-label"
              aria-label="Course label"
              placeholder="e.g. GC 4060"
              value={course.courseLabel}
              onChange={(e) => setCourse(prev => ({ ...prev, courseLabel: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="course-syllabus">Syllabus</Label>
            <SampleSyllabusButton
              onLoad={(code, text) => setCourse({ courseLabel: code, syllabusText: text })}
            />
            <Textarea
              id="course-syllabus"
              aria-label="Course syllabus"
              placeholder="Paste the syllabus of the course you want to analyze..."
              rows={8}
              value={course.syllabusText}
              onChange={(e) => setCourse(prev => ({ ...prev, syllabusText: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Prior coursework card — appears SECOND */}
      <Card>
        <CardHeader>
          <CardTitle>Prior coursework</CardTitle>
          <p className="text-sm text-muted-foreground">Any prerequisite or expected prior coursework. Order doesn&apos;t matter.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {priorCoursework.map((c, index) => (
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
              <div className="space-y-2">
                <Label htmlFor={`prior-label-${index}`}>Prior course label</Label>
                <Input
                  id={`prior-label-${index}`}
                  aria-label={`Prior course ${index + 1} label`}
                  placeholder="e.g. GC 3460"
                  value={c.courseLabel}
                  onChange={(e) => updatePriorCourse(index, 'courseLabel', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`prior-syllabus-${index}`}>Syllabus</Label>
                <SampleSyllabusButton
                  onLoad={(code, text) => {
                    setPriorCoursework(prev => prev.map((entry, i) =>
                      i === index ? { courseLabel: code, syllabusText: text } : entry
                    ));
                  }}
                />
                <Textarea
                  id={`prior-syllabus-${index}`}
                  aria-label={`Prior course ${index + 1} syllabus`}
                  placeholder="Paste the syllabus of this prior course..."
                  rows={8}
                  value={c.syllabusText}
                  onChange={(e) => updatePriorCourse(index, 'syllabusText', e.target.value)}
                />
              </div>
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
