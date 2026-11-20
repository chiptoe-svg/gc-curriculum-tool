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

  const inputClass = 'cs-input';

  if (done) {
    const viewHref = `/view/${encodeURIComponent(done.code)}`;
    return (
      <div className="cs-card cs-card-pad cs-stack">
        <p className="cs-h2">Course added: {done.code}</p>
        <p className="cs-meta">
          The course is in the catalog. A faculty editor will capture its profile.
        </p>
        <div className="cs-row">
          <a
            href={viewHref}
            className="cs-btn"
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
            className="cs-link cs-link-quiet"
          >
            Add another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cs-card cs-card-pad">
      <p className="cs-meta mb-6">
        {canCapture
          ? 'Add a course to the roster, then go straight into CourseCapture Step 1.'
          : 'Add a course to the roster. It becomes available for a faculty editor to capture.'}
      </p>

      <form onSubmit={handleSubmit} className="cs-stack">
        <div className="cs-row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <div className="cs-field" style={{ width: '6rem', flex: 'none' }}>
            <label htmlFor="course-prefix">
              Prefix <span style={{ color: '#9B2C2C' }}>*</span>
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

          <div className="cs-field" style={{ flex: 1 }}>
            <label htmlFor="course-number">
              Course number <span style={{ color: '#9B2C2C' }}>*</span>
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

        <div className="cs-field">
          <label htmlFor="course-title">
            Title <span style={{ color: '#9B2C2C' }}>*</span>
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

        <div className="cs-field">
          <label htmlFor="catalog-url">
            Catalog URL <small>(optional)</small>
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
            className="cs-link cs-link-quiet"
            style={{ alignSelf: 'flex-start', minHeight: 36 }}
            disabled={pending}
          >
            + Add a paired course (e.g. lab)
          </button>
        )}

        {pairedOpen && (
          <div className="cs-dashed">
            <p className="cs-flabel" style={{ fontWeight: 600, fontSize: 14 }}>Paired course</p>

            <div className="cs-field">
              <label htmlFor="paired-number">
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
              <p className="cs-meta" style={{ fontSize: 13 }}>
                Uses the same prefix ({prefix.trim() || 'GC'}).
              </p>
            </div>

            <div className="cs-field">
              <label htmlFor="paired-role">
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
              className="cs-link cs-link-quiet"
              style={{ alignSelf: 'flex-start' }}
              disabled={pending}
            >
              Remove paired course
            </button>
          </div>
        )}

        {error && (
          <p className="cs-alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="cs-btn cs-btn-primary cs-btn-block"
        >
          {pending ? 'Adding…' : canCapture ? 'Add course & start capture' : 'Add course'}
        </button>
      </form>
    </div>
  );
}
