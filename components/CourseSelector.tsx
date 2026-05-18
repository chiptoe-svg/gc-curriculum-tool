'use client';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface CourseListItem {
  code: string;
  title: string;
  level: number;
  track: string;
}

interface Props {
  slug: string;
  selectedCode: string;
  onSelect: (code: string) => void;
  label: string;
  excludeCode?: string;       // hide the course being analyzed from prior-coursework lists
  inputId: string;            // for label association
}

export function CourseSelector({ slug, selectedCode, onSelect, label, excludeCode, inputId }: Props) {
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
        {filtered.map(c => (
          <button
            key={c.code}
            type="button"
            onClick={() => onSelect(c.code)}
            className={`block w-full text-left px-3 py-2 hover:bg-muted text-sm ${
              c.code === selectedCode ? 'bg-muted font-medium' : ''
            }`}
          >
            <span className="font-mono text-xs text-muted-foreground mr-2">{c.code}</span>
            {c.title}
          </button>
        ))}
      </div>
    </div>
  );
}
