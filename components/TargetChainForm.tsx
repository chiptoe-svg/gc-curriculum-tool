'use client';

import { useState, useMemo, useEffect } from 'react';
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

export function TargetChainForm({ slug, targets, courses, fullTarget, onAnalyze, isAnalyzing }: Props) {
  const [careerTargetId, setCareerTargetId] = useState(targets[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  function handleAnalyze() {
    const orderedSelected = courses.filter(c => selected.has(c.code));
    onAnalyze({
      careerTargetId,
      courses: orderedSelected.map(c => ({ courseLabel: c.code, syllabusText: c.syllabusText })),
    });
  }

  const count = selected.size;
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

      <div className="flex justify-end">
        <Button onClick={handleAnalyze} disabled={!canAnalyze || isAnalyzing}>
          {isAnalyzing ? 'Analyzing…' : 'Analyze'}
        </Button>
      </div>
    </div>
  );
}
