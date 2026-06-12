'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  slug: string;
}

export function NewCourseForm({ slug }: Props) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [catalogUrl, setCatalogUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedCode = code.trim();
    const trimmedTitle = title.trim();
    const trimmedUrl = catalogUrl.trim();

    if (!trimmedCode || !trimmedTitle) {
      setError('Course code and title are required.');
      return;
    }

    startTransition(async () => {
      // Same body shape used by CourseRosterControls.submitOne():
      //   { mode: 'one', code, title, catalogUrl? }
      const body: Record<string, unknown> = {
        mode: 'one',
        code: trimmedCode,
        title: trimmedTitle,
      };
      if (trimmedUrl) body.catalogUrl = trimmedUrl;

      const res = await fetch(
        `/api/admin/courses/roster?slug=${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      const json = await res.json().catch(() => ({})) as Record<string, unknown>;

      if (!res.ok) {
        setError((json.error as string | undefined) ?? `Error ${res.status}`);
        return;
      }

      // Success — land directly on Step 1 of CourseCapture for this code
      router.push(`/capture/${encodeURIComponent(trimmedCode)}?slug=${encodeURIComponent(slug)}`);
    });
  }

  const inputClass =
    'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <p className="mb-6 text-sm text-muted-foreground">
        Add a course to the roster, then go straight into CourseCapture Step 1.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="course-code">
            Course code <span className="text-destructive">*</span>
          </label>
          <input
            id="course-code"
            type="text"
            required
            placeholder="GC 1234"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputClass}
            disabled={pending}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="course-title">
            Title <span className="text-destructive">*</span>
          </label>
          <input
            id="course-title"
            type="text"
            required
            placeholder="Introduction to Graphic Communications"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            disabled={pending}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="catalog-url">
            Catalog URL <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <input
            id="catalog-url"
            type="url"
            placeholder="https://catalog.clemson.edu/…"
            value={catalogUrl}
            onChange={(e) => setCatalogUrl(e.target.value)}
            className={inputClass}
            disabled={pending}
          />
        </div>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add course → open CourseCapture'}
        </button>
      </form>
    </div>
  );
}
