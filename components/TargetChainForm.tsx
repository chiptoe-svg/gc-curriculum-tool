'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { TargetKUDPreview } from './TargetKUDPreview';
import type { CareerTarget } from '@/lib/domain/types';

export interface TargetOption {
  id: string;
  name: string;
}

export interface CourseChoice {
  code: string;
  title: string;
  level: number;
  track: string;
  syllabusText: string;
}

export interface TargetChainAnalyzeInput {
  careerTargetId: string;
  courses: Array<{ courseLabel: string; syllabusText: string }>;
}

interface Props {
  slug: string;
  targets: TargetOption[];
  courses: CourseChoice[];
  fullTarget?: CareerTarget | null;  // for K/U/D preview; optional so loading state works
  onAnalyze: (input: TargetChainAnalyzeInput) => void;
  isAnalyzing: boolean;
}

const CAP = 16;
const MIN_TO_ANALYZE = 2;

interface ExternalCourse {
  id: string;
  label: string;
  syllabusText: string | null;
  fileName: string | null;
  extracting: boolean;
  extractError: string | null;
}

function isExternalReady(ec: ExternalCourse): boolean {
  return ec.label.trim().length > 0 && ec.syllabusText !== null;
}

function ExternalCourseRow({
  entry,
  slug,
  onUpdate,
  onRemove,
}: {
  entry: ExternalCourse;
  slug: string;
  onUpdate: (next: ExternalCourse) => void;
  onRemove: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    onUpdate({ ...entry, extracting: true, extractError: null, syllabusText: null, fileName: null });
    const form = new FormData();
    form.set('slug', slug);
    form.set('file', file);
    try {
      const res = await fetch('/api/extract-syllabus', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) {
        onUpdate({ ...entry, extracting: false, extractError: (json as { error?: string }).error ?? `Failed (${res.status})` });
        return;
      }
      onUpdate({ ...entry, extracting: false, syllabusText: (json as { text: string }).text, fileName: file.name, extractError: null });
    } catch {
      onUpdate({ ...entry, extracting: false, extractError: 'Failed to extract text. Try a different file.' });
    }
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed p-3">
      <div className="flex-1 space-y-2">
        <input
          type="text"
          value={entry.label}
          onChange={(e) => onUpdate({ ...entry, label: e.target.value })}
          placeholder="Course name or code (e.g. ENGL 101 — Composition)"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={entry.extracting}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            {entry.extracting ? 'Extracting…' : entry.fileName ? 'Replace syllabus' : 'Attach syllabus (PDF or DOCX)'}
          </button>
          {entry.fileName && !entry.extracting && (
            <span className="text-xs text-green-700">{entry.fileName} — ready</span>
          )}
          {entry.extractError && (
            <span className="text-xs text-destructive">{entry.extractError}</span>
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
      <button
        type="button"
        onClick={onRemove}
        className="mt-1 text-muted-foreground hover:text-destructive text-sm leading-none"
        aria-label="Remove external course"
      >
        ✕
      </button>
    </div>
  );
}

export function TargetChainForm({ slug, targets, courses, fullTarget, onAnalyze, isAnalyzing }: Props) {
  const [careerTargetId, setCareerTargetId] = useState(targets[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [externalCourses, setExternalCourses] = useState<ExternalCourse[]>([]);

  // `targets` arrives via an async fetch, so it is often empty on first render
  // and the useState initializer above misses it. Default to the first target
  // once the list loads (unless the user has already picked one).
  useEffect(() => {
    if (!careerTargetId && targets[0]) setCareerTargetId(targets[0].id);
  }, [targets, careerTargetId]);

  const groupedByLevel = useMemo(() => {
    const groups = new Map<number, CourseChoice[]>();
    for (const c of courses) {
      const arr = groups.get(c.level) ?? [];
      arr.push(c);
      groups.set(c.level, arr);
    }
    for (const arr of groups.values()) arr.sort((a, b) => a.code.localeCompare(b.code));
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [courses]);

  function toggle(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setSelected(next);
  }

  function clearAll() {
    setSelected(new Set());
  }

  function addExternalCourse() {
    setExternalCourses(prev => [...prev, {
      id: crypto.randomUUID(),
      label: '',
      syllabusText: null,
      fileName: null,
      extracting: false,
      extractError: null,
    }]);
  }

  function updateExternalCourse(id: string, next: ExternalCourse) {
    setExternalCourses(prev => prev.map(ec => ec.id === id ? next : ec));
  }

  function removeExternalCourse(id: string) {
    setExternalCourses(prev => prev.filter(ec => ec.id !== id));
  }

  function handleAnalyze() {
    const orderedSelected = courses.filter(c => selected.has(c.code));
    const readyExternal = externalCourses.filter(isExternalReady);
    onAnalyze({
      careerTargetId,
      courses: [
        ...orderedSelected.map(c => ({ courseLabel: c.code, syllabusText: c.syllabusText })),
        ...readyExternal.map(ec => ({ courseLabel: ec.label, syllabusText: ec.syllabusText! })),
      ],
    });
  }

  const readyExternalCount = externalCourses.filter(isExternalReady).length;
  const count = selected.size + readyExternalCount;
  const canAnalyze = count >= MIN_TO_ANALYZE && count <= CAP && Boolean(careerTargetId);
  const atCap = count >= CAP;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="target-picker">Career target</Label>
        <Select value={careerTargetId} onValueChange={(v) => setCareerTargetId(v ?? '')}>
          <SelectTrigger id="target-picker" className="w-full">
            <SelectValue placeholder="Pick a career target" />
          </SelectTrigger>
          <SelectContent>
            {targets.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TargetKUDPreview slug={slug} target={fullTarget ?? null} />

      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            <span className={count > 0 ? 'text-foreground' : 'text-muted-foreground'}>{count} of {CAP}</span> max selected
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-blue-700 hover:underline disabled:text-muted-foreground"
            disabled={count === 0}
          >
            Clear all
          </button>
        </div>
        {groupedByLevel.length === 0 ? (
          <p className="text-sm text-muted-foreground">No courses loaded.</p>
        ) : (
          <div className="space-y-4">
            {groupedByLevel.map(([level, items]) => (
              <div key={level} className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Level {level}</div>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {items.map(c => {
                    const isSel = selected.has(c.code);
                    const disable = !isSel && atCap;
                    return (
                      <li key={c.code}>
                        <label className="flex items-center gap-2 rounded px-2 py-1 hover:bg-accent/40 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggle(c.code)}
                            disabled={disable}
                          />
                          <span className="text-sm">
                            <span className="font-medium">{c.code}</span>{' '}
                            <span className="text-muted-foreground">{c.title}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* External courses */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">External courses</p>
            <p className="text-xs text-muted-foreground">Add courses from outside GC by attaching a syllabus.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={addExternalCourse}
            disabled={atCap}
          >
            + Add course
          </Button>
        </div>
        {externalCourses.length > 0 && (
          <div className="space-y-2">
            {externalCourses.map(ec => (
              <ExternalCourseRow
                key={ec.id}
                entry={ec}
                slug={slug}
                onUpdate={(next) => updateExternalCourse(ec.id, next)}
                onRemove={() => removeExternalCourse(ec.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleAnalyze} disabled={!canAnalyze || isAnalyzing}>
          {isAnalyzing ? 'Analyzing…' : 'Analyze'}
        </Button>
      </div>
    </div>
  );
}
