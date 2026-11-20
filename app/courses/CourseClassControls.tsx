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
        className="cs-link cs-link-quiet"
        title="Edit category / career mapping / catalog URL"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="cs-pop">
      <div className="cs-row" style={{ justifyContent: 'space-between' }}>
        <span className="cs-label">{code}</span>
        <button onClick={() => setOpen(false)} className="cs-x" aria-label="Close">✕</button>
      </div>
      <label className="cs-field">
        <span className="cs-label">Category</span>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value as CourseCategory)}
          className="cs-input cs-input-sm"
        >
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </label>
      <label className="cs-check">
        <input type="checkbox" checked={builds} onChange={(e) => setBuilds(e.target.checked)} />
        <span>Builds toward career outcomes</span>
      </label>
      <label className="cs-field">
        <span className="cs-label">Catalog URL</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://catalog.clemson.edu/…"
          className="cs-input cs-input-sm"
        />
      </label>
      {error && <p className="cs-err">{error}</p>}
      <div className="cs-row" style={{ justifyContent: 'flex-end' }}>
        <button
          onClick={save}
          disabled={pending}
          className="cs-btn cs-btn-primary cs-btn-sm"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
