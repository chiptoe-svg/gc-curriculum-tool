'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SampleSyllabusButton } from './SampleSyllabusButton';

const MAX_UPSTREAM_COURSES = 8;

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
  upstreamChain: CourseInput[];
  downstream: CourseInput;
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
  const [upstreamChain, setUpstreamChain] = useState<CourseInput[]>([{ courseLabel: '', syllabusText: '' }]);
  const [downstream, setDownstream] = useState<CourseInput>({ courseLabel: '', syllabusText: '' });

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
    upstreamChain.length >= 1 &&
    upstreamChain.every(isValidCourse) &&
    isValidCourse(downstream);

  function addUpstreamCourse() {
    if (upstreamChain.length < MAX_UPSTREAM_COURSES) {
      setUpstreamChain(prev => [...prev, { courseLabel: '', syllabusText: '' }]);
    }
  }

  function removeUpstreamCourse(index: number) {
    if (upstreamChain.length <= 1) return;
    setUpstreamChain(prev => prev.filter((_, i) => i !== index));
  }

  function updateUpstreamCourse(index: number, field: keyof CourseInput, value: string) {
    setUpstreamChain(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  }

  function handleSubmit() {
    onAnalyze({ careerTargetId, upstreamChain, downstream });
  }

  return (
    <div className="space-y-6">
      {/* Upstream courses card */}
      <Card>
        <CardHeader>
          <CardTitle>Upstream courses <span className="text-sm font-normal text-muted-foreground">(in sequence order, earliest first)</span></CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {upstreamChain.map((course, index) => (
            <div key={index} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">Upstream course {index + 1}</span>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => removeUpstreamCourse(index)}
                  disabled={upstreamChain.length <= 1}
                  aria-label={`Remove upstream course ${index + 1}`}
                >
                  Remove
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`upstream-label-${index}`}>Course label</Label>
                <Input
                  id={`upstream-label-${index}`}
                  aria-label={`Upstream course ${index + 1} label`}
                  placeholder="e.g. GC 3460"
                  value={course.courseLabel}
                  onChange={(e) => updateUpstreamCourse(index, 'courseLabel', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`upstream-syllabus-${index}`}>Syllabus</Label>
                <SampleSyllabusButton
                  onLoad={(code, text) => {
                    setUpstreamChain(prev => prev.map((c, i) =>
                      i === index ? { courseLabel: code, syllabusText: text } : c
                    ));
                  }}
                />
                <Textarea
                  id={`upstream-syllabus-${index}`}
                  aria-label={`Upstream course ${index + 1} syllabus`}
                  placeholder="Paste the syllabus of this upstream course..."
                  rows={8}
                  value={course.syllabusText}
                  onChange={(e) => updateUpstreamCourse(index, 'syllabusText', e.target.value)}
                />
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            type="button"
            onClick={addUpstreamCourse}
            disabled={upstreamChain.length >= MAX_UPSTREAM_COURSES}
          >
            {upstreamChain.length >= MAX_UPSTREAM_COURSES
              ? `Maximum ${MAX_UPSTREAM_COURSES} upstream courses`
              : 'Add upstream course'}
          </Button>
        </CardContent>
      </Card>

      {/* Downstream course card */}
      <Card>
        <CardHeader>
          <CardTitle>Downstream course</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="downstream-label">Course label</Label>
            <Input
              id="downstream-label"
              aria-label="Downstream course label"
              placeholder="e.g. GC 4060"
              value={downstream.courseLabel}
              onChange={(e) => setDownstream(prev => ({ ...prev, courseLabel: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="downstream-syllabus">Syllabus</Label>
            <SampleSyllabusButton
              onLoad={(code, text) => setDownstream({ courseLabel: code, syllabusText: text })}
            />
            <Textarea
              id="downstream-syllabus"
              aria-label="Downstream course syllabus"
              placeholder="Paste the syllabus of the later course in the sequence..."
              rows={8}
              value={downstream.syllabusText}
              onChange={(e) => setDownstream(prev => ({ ...prev, syllabusText: e.target.value }))}
            />
          </div>
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
