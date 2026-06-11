'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CATEGORY_ORDER, CATEGORY_LABELS, type CourseCategory } from '@/lib/db/course-category-seed';

interface Props {
  code: string;
  slug: string;
  category: CourseCategory;
  buildsToCareer: boolean;
  catalogUrl: string | null;
}

export function CourseClassControls({ code, slug, category, buildsToCareer, catalogUrl }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<CourseCategory>(category);
  const [builds, setBuilds] = useState(buildsToCareer);
  const [url, setUrl] = useState(catalogUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/courses/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: cat, buildsToCareer: builds, catalogUrl: url.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError((json as { error?: string }).error ?? 'Update failed');
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
        title="Edit category / career mapping / catalog URL"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="absolute right-2 top-10 z-10 w-72 rounded-lg border border-border bg-card p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{code}</span>
        <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <label className="mb-2 block">
        <span className="mb-1 block font-body-sans text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">Category</span>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value as CourseCategory)}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-[12px]"
        >
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </label>
      <label className="mb-2 flex items-center gap-2">
        <input type="checkbox" checked={builds} onChange={(e) => setBuilds(e.target.checked)} />
        <span className="font-body-sans text-[12px]">Builds toward career outcomes</span>
      </label>
      <label className="mb-2 block">
        <span className="mb-1 block font-body-sans text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">Catalog URL</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://catalog.clemson.edu/…"
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-[12px]"
        />
      </label>
      {error && <p className="mb-2 font-body-sans text-[11px] text-destructive">{error}</p>}
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-md bg-foreground px-3 py-1 font-body-sans text-[11px] uppercase tracking-[0.14em] text-background disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
