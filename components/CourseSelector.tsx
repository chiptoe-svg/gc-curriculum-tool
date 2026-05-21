'use client';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface CourseListItem {
  code: string;
  title: string;
  level: number;
  track: string;
  builderStatus?: string;
}

interface Props {
  slug: string;
  selectedCode: string;
  onSelect: (code: string) => void;
  label: string;
  excludeCode?: string;
  inputId: string;
  requireApproved?: boolean;
}

export function CourseSelector({ slug, selectedCode, onSelect, label, excludeCode, inputId, requireApproved }: Props) {
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/courses?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then((data: CourseListItem[]) => setCourses(data))
      .catch(() => setCourses([]))
      .finally(() => setLoading(false));
  }, [slug]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = excludeCode ? courses.filter(c => c.code !== excludeCode) : courses;
    if (!q) return pool;
    return pool.filter(c =>
      c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)
    );
  }, [courses, query, excludeCode]);

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        placeholder={loading ? 'Loading courses…' : 'Search courses (e.g. 3460, brand, photography)'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={loading}
      />
      <div className="rounded-lg border max-h-48 overflow-y-auto">
        {filtered.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground p-3">No courses match.</p>
        )}
        {filtered.map(c => {
          const isApproved = !requireApproved || c.builderStatus === 'approved';
          const statusLabel = c.builderStatus && c.builderStatus !== 'approved' ? c.builderStatus.replace('_', ' ') : null;
          return (
            <button
              key={c.code}
              type="button"
              onClick={() => isApproved ? onSelect(c.code) : undefined}
              disabled={!isApproved}
              title={!isApproved ? `KUD profile not yet approved (${statusLabel ?? 'draft'})` : undefined}
              className={`block w-full text-left px-3 py-2 text-sm ${
                !isApproved
                  ? 'opacity-40 cursor-not-allowed text-muted-foreground'
                  : c.code === selectedCode
                  ? 'bg-muted font-medium hover:bg-muted'
                  : 'hover:bg-muted'
              }`}
            >
              <span className="font-mono text-xs text-muted-foreground mr-2">{c.code}</span>
              {c.title}
              {!isApproved && statusLabel && (
                <span className="ml-2 text-xs opacity-60">({statusLabel})</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
