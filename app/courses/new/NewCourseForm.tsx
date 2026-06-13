'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  slug: string;
  /** Faculty (full) → redirect into capture on success. Creator → show a
   *  confirmation instead. Defaults to true so existing callers/tests keep
   *  the capture-redirect behavior. */
  canCapture?: boolean;
}

export function NewCourseForm({ slug, canCapture = true }: Props) {
  const router = useRouter();
  const [prefix, setPrefix] = useState('GC');
  const [courseNumber, setCourseNumber] = useState('');
  const [title, setTitle] = useState('');
  const [catalogUrl, setCatalogUrl] = useState('');
  const [pairedOpen, setPairedOpen] = useState(false);
  const [pairedNumber, setPairedNumber] = useState('');
  const [pairedRole, setPairedRole] = useState<'lab' | 'lecture' | 'other'>('lab');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedPrefix = prefix.trim();
    const trimmedNumber = courseNumber.trim();
    const trimmedTitle = title.trim();
    const trimmedUrl = catalogUrl.trim();

    if (!trimmedPrefix || !trimmedNumber || !trimmedTitle) {
      setError('Prefix, course number, and title are required.');
      return;
    }

    const code = `${trimmedPrefix} ${trimmedNumber}`;
    const pairedIncluded = pairedOpen && pairedNumber.trim() !== '';
    const pairedCode = pairedIncluded ? `${trimmedPrefix} ${pairedNumber.trim()}` : undefined;

    startTransition(async () => {
      const body: Record<string, unknown> = {
        mode: 'one',
        code,
        title: trimmedTitle,
      };
      if (trimmedUrl) body.catalogUrl = trimmedUrl;
      if (pairedIncluded) {
        body.pairedCode = pairedCode;
        body.pairedRole = pairedRole;
      }

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

      if (canCapture) {
        // Faculty — land directly on Step 1 of CourseCapture for this code.
        router.push(`/capture/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`);
      } else {
        // Create-only role — confirm and stay out of the editor.
        setDone({ code });
      }
    });
  }

  const inputClass =
    'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  if (done) {
    const viewHref = `/view/${encodeURIComponent(done.code)}`;
    return (
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-4">
        <p className="text-sm font-medium">Course added: {done.code}</p>
        <p className="text-sm text-muted-foreground">
          The course is in the catalog. A faculty editor will capture its profile.
        </p>
        <div className="flex items-center gap-4">
          <a
            href={viewHref}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            View course →
          </a>
          <button
            type="button"
            onClick={() => {
              setDone(null);
              setPrefix('GC');
              setCourseNumber('');
              setTitle('');
              setCatalogUrl('');
              setPairedOpen(false);
              setPairedNumber('');
              setPairedRole('lab');
              setError(null);
            }}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Add another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <p className="mb-6 text-sm text-muted-foreground">
        {canCapture
          ? 'Add a course to the roster, then go straight into CourseCapture Step 1.'
          : 'Add a course to the roster. It becomes available for a faculty editor to capture.'}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-3">
          <div className="w-24">
            <label className="mb-1 block text-sm font-medium" htmlFor="course-prefix">
              Prefix <span className="text-destructive">*</span>
            </label>
            <input
              id="course-prefix"
              type="text"
              placeholder="GC"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </div>

          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium" htmlFor="course-number">
              Course number <span className="text-destructive">*</span>
            </label>
            <input
              id="course-number"
              type="text"
              placeholder="3460"
              value={courseNumber}
              onChange={(e) => setCourseNumber(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="course-title">
            Title <span className="text-destructive">*</span>
          </label>
          <input
            id="course-title"
            type="text"
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

        {/* Paired course disclosure */}
        {!pairedOpen && (
          <button
            type="button"
            onClick={() => setPairedOpen(true)}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
            disabled={pending}
          >
            + Add a paired course (e.g. lab)
          </button>
        )}

        {pairedOpen && (
          <div className="rounded-md border border-border p-4 space-y-3">
            <p className="text-sm font-medium">Paired course</p>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="paired-number">
                Paired number
              </label>
              <input
                id="paired-number"
                type="text"
                placeholder="3461"
                value={pairedNumber}
                onChange={(e) => setPairedNumber(e.target.value)}
                className={inputClass}
                disabled={pending}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Uses the same prefix ({prefix.trim() || 'GC'}).
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="paired-role">
                Paired role
              </label>
              <select
                id="paired-role"
                value={pairedRole}
                onChange={(e) => setPairedRole(e.target.value as 'lab' | 'lecture' | 'other')}
                className={inputClass}
                disabled={pending}
              >
                <option value="lab">Lab</option>
                <option value="lecture">Lecture</option>
                <option value="other">Other</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => { setPairedOpen(false); setPairedNumber(''); setPairedRole('lab'); }}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              disabled={pending}
            >
              Remove paired course
            </button>
          </div>
        )}

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
          {pending ? 'Adding…' : canCapture ? 'Add course & start capture' : 'Add course'}
        </button>
      </form>
    </div>
  );
}
