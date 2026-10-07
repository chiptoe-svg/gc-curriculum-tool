'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { CATEGORY_ORDER, CATEGORY_LABELS, type CourseCategory } from '@/lib/db/course-category-seed';

export interface AccessCourse { code: string; title: string; }

interface CatalogLookup {
  found: boolean;
  code: string;
  title: string | null;
  description: string | null;
  onCourseList: boolean;
  baseCode: string | null;
  baseTitle: string | null;
}

/** A course code shape loose enough for "should we try a catalog lookup",
 * not a validator — the server is the source of truth either way. */
const CODE_SHAPE = /^[A-Za-z]{2,6}\s*\d{3,4}[A-Za-z]{0,2}$/;

export interface AccessGrant {
  id: string;
  label: string;
  email: string | null;
  scope: string[];
  can: ('capture' | 'create' | 'admin')[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
}

interface Minted { grant: AccessGrant; link: string }

// Faculty access panel client (spec:
// docs/superpowers/specs/2026-10-07-faculty-access-panel-design.md).
// Admin /api second factor goes in the body/query, NOT an Authorization
// header — a Bearer header would override the browser's automatic HTTP Basic
// Auth and break the middleware gate (same convention as SandboxGrantsPanel
// and PartnersTable). Plain words throughout: no "grant"/"scope"/"token" in
// the UI copy.
export function AccessPanel({ slug, courses }: { slug: string; courses: AccessCourse[] }) {
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [showRevoked, setShowRevoked] = useState(false);

  // The course list starts from the server-rendered prop but grows locally
  // when "Add a course" (or the picker shortcut below) creates one, so it
  // shows up immediately without a full page reload.
  const [courseOptions, setCourseOptions] = useState<AccessCourse[]>(courses);

  // Add-faculty form state.
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  const [allCourses, setAllCourses] = useState(false);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [courseFilter, setCourseFilter] = useState('');
  const [canCreate, setCanCreate] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  // Inline-edit state: at most one row open at a time.
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add-a-course section state (access-panel addendum, 2026-10-07).
  const [newCode, setNewCode] = useState('');
  const [newLookup, setNewLookup] = useState<CatalogLookup | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<CourseCategory>('other');
  const [addCourseError, setAddCourseError] = useState<string | null>(null);
  const [addCourseSuccess, setAddCourseSuccess] = useState<string | null>(null);

  // The course-picker shortcut: when the filter box matches nothing and
  // looks code-shaped, offer to add it (debounced).
  const [pickerHint, setPickerHint] = useState<CatalogLookup | null>(null);

  async function load() {
    const res = await fetch(`/api/admin/access?slug=${encodeURIComponent(slug)}`);
    if (res.ok) {
      const json = (await res.json()) as { grants: AccessGrant[] };
      setGrants(json.grants);
    }
  }

  useEffect(() => { void load(); }, []);

  function resetForm() {
    setLabel(''); setEmail(''); setAllCourses(false); setSelectedCourses([]);
    setCourseFilter(''); setCanCreate(false); setExpiresAt('');
  }

  function create() {
    setError(null);
    start(async () => {
      const body = {
        slug,
        label,
        email: email.trim() || null,
        courses: allCourses ? '*' : selectedCourses,
        canCreate,
        expiresAt: expiresAt || null,
      };
      const res = await fetch('/api/admin/access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? `Failed to add (${res.status})`);
        return;
      }
      const minted = (await res.json()) as Minted;
      setMinted(minted);
      resetForm();
      await load();
    });
  }

  // The server's error message is more useful than the bare status (e.g.
  // "this grant is expired — edit the expiry first" vs "Save failed: 409").
  async function serverError(res: Response, fallback: string): Promise<string> {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return json.error ?? `${fallback} (${res.status})`;
  }

  async function saveEdit(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/access/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...patch, slug }),
    });
    if (!res.ok) {
      alert(await serverError(res, 'Save failed'));
      return;
    }
    setEditingId(null);
    await load();
  }

  async function reissue(id: string) {
    if (!confirm('The old link stops working now. Continue?')) return;
    const res = await fetch(`/api/admin/access/${id}/reissue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    if (!res.ok) {
      alert(await serverError(res, 'Send a new link failed'));
      return;
    }
    const minted = (await res.json()) as Minted;
    setMinted(minted);
    await load();
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this access link?')) return;
    const res = await fetch(`/api/admin/access/${id}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    if (!res.ok) {
      alert(await serverError(res, 'Revoke failed'));
      return;
    }
    await load();
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); }
      finally { document.body.removeChild(ta); }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function composeEmailHref(grant: AccessGrant, link: string): string {
    const subject = 'Your access to the GC Curriculum Tool';
    const firstName = grant.label.trim().split(/\s+/)[0] || grant.label;
    const courseList = grant.scope.includes('*') ? 'all courses' : grant.scope.join(', ');
    const howto = `${typeof window !== 'undefined' ? window.location.origin : ''}/curriculum/howto`;
    const body = [
      `Hi ${firstName},`,
      '',
      `You now have access to the GC Curriculum Tool for ${courseList}.`,
      '',
      `Your personal link:`,
      link,
      '',
      `How to use it: ${howto}`,
      '',
      `This link signs you in on this browser for 30 days at a time — please don't share it.`,
      '',
      `— Chip`,
    ].join('\n');
    const to = grant.email ? encodeURIComponent(grant.email) : '';
    return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  const visibleCourses = useMemo(() => {
    const f = courseFilter.trim().toLowerCase();
    if (!f) return courseOptions;
    return courseOptions.filter((c) => c.code.toLowerCase().includes(f) || c.title.toLowerCase().includes(f));
  }, [courseOptions, courseFilter]);

  const visibleGrants = showRevoked ? grants : grants.filter((g) => g.status !== 'revoked');

  function toggleCourse(code: string) {
    setSelectedCourses((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function lookupCourseCode(code: string): Promise<CatalogLookup | null> {
    const trimmed = code.trim();
    if (!trimmed) return null;
    const res = await fetch(`/api/admin/access/catalog?code=${encodeURIComponent(trimmed)}&slug=${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    return (await res.json()) as CatalogLookup;
  }

  async function onNewCodeBlur() {
    const code = newCode.trim();
    if (!code) { setNewLookup(null); return; }
    const r = await lookupCourseCode(code);
    setNewLookup(r);
    if (r?.found && r.title) setNewTitle(r.title);
  }

  async function addCourse() {
    setAddCourseError(null);
    setAddCourseSuccess(null);
    const code = newCode.trim();
    if (!code) { setAddCourseError('Course code is required'); return; }
    const body: Record<string, unknown> = { code, category: newCategory, slug };
    if (!newLookup?.found) body.title = newTitle;
    const res = await fetch('/api/admin/access/courses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setAddCourseError(await serverError(res, 'Add failed'));
      return;
    }
    const created = (await res.json()) as { code: string; title: string; category: string; categoryLabel: string };
    setCourseOptions((prev) => [...prev, { code: created.code, title: created.title }]);
    setAddCourseSuccess(`Added ${created.code} — ${created.title} to ${created.categoryLabel}.`);
    setNewCode(''); setNewLookup(null); setNewTitle(''); setNewCategory('other');
  }

  // Picker shortcut: debounce a catalog check while the filter box matches
  // no existing course and looks code-shaped.
  useEffect(() => {
    if (allCourses) { setPickerHint(null); return; }
    const text = courseFilter.trim();
    if (!CODE_SHAPE.test(text) || visibleCourses.length > 0) { setPickerHint(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      void lookupCourseCode(text).then((r) => { if (!cancelled) setPickerHint(r); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lookupCourseCode is stable per render; re-running on it would just re-debounce identically.
  }, [courseFilter, allCourses, visibleCourses.length]);

  async function handlePickerAdd() {
    if (!pickerHint) return;
    if (pickerHint.found) {
      const res = await fetch('/api/admin/access/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: pickerHint.code, category: 'other', slug }),
      });
      if (!res.ok) { alert(await serverError(res, 'Add course failed')); return; }
      const created = (await res.json()) as { code: string; title: string };
      setCourseOptions((prev) => [...prev, { code: created.code, title: created.title }]);
      setSelectedCourses((prev) => [...prev, created.code]);
      setCourseFilter('');
      setPickerHint(null);
    } else {
      // Not in the catalog — open the Add-a-course section prefilled rather
      // than creating blind (it needs a title).
      setNewCode(pickerHint.code);
      setNewLookup(pickerHint);
      setCourseFilter('');
      setPickerHint(null);
    }
  }

  return (
    <section className="space-y-6 rounded-lg border border-slate-200 bg-white p-6">
      <div>
        <h2 className="text-lg font-semibold">Faculty access</h2>
        <p className="text-sm text-slate-600">
          Add a person, see who has access, change their courses, send a new link, or revoke.
        </p>
      </div>

      {/* Add a course (access-panel addendum, 2026-10-07) */}
      <div className="space-y-3 border-b border-slate-200 pb-6">
        <h3 className="text-sm font-medium text-slate-700">Add a course</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="new-course-code" className="text-xs text-slate-500">Course code</label>
            <input
              id="new-course-code"
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={newCode}
              onChange={(e) => { setNewCode(e.target.value); setNewLookup(null); }}
              onBlur={onNewCodeBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void onNewCodeBlur(); } }}
              placeholder="ENTR 4080"
            />
          </div>
          {newLookup?.found ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Title (from the Clemson catalog)</span>
              <p className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700">{newLookup.title}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="new-course-title" className="text-xs text-slate-500">Title</label>
              <input
                id="new-course-title"
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Family Business"
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor="new-course-category" className="text-xs text-slate-500">Section</label>
            <select
              id="new-course-category"
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as CourseCategory)}
            >
              {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <button type="button" onClick={addCourse} className="rounded bg-slate-800 px-4 py-1.5 text-sm text-white">Add</button>
        </div>
        {newLookup && !newLookup.found && (
          <p className="text-xs text-slate-500">
            {newLookup.baseCode
              ? `Sections of ${newLookup.baseCode} are titled "${newLookup.baseTitle}" — give this section its own title.`
              : 'Not in the Clemson catalog — add it with your own title.'}
          </p>
        )}
        {newLookup?.onCourseList && (
          <p className="text-xs text-amber-700">{newLookup.code} is already on the course list.</p>
        )}
        {addCourseError && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{addCourseError}</p>}
        {addCourseSuccess && <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{addCourseSuccess}</p>}
      </div>

      {/* Add faculty */}
      <div className="space-y-3 border-b border-slate-200 pb-6">
        <h3 className="text-sm font-medium text-slate-700">Add faculty</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="access-name" className="text-xs text-slate-500">Name</label>
            <input id="access-name" className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Danita Swaney" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="access-email" className="text-xs text-slate-500">Email</label>
            <input id="access-email" type="email" className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="danita@clemson.edu" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="access-expires" className="text-xs text-slate-500">Expires (empty = never)</label>
            <input id="access-expires" type="date" className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={allCourses} onChange={(e) => setAllCourses(e.target.checked)} />
            All courses
          </label>
          {!allCourses && (
            <div className="space-y-1">
              <input
                className="w-64 rounded border border-slate-300 px-2 py-1 text-xs"
                placeholder="Search courses…"
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
              />
              <div className="max-h-40 w-full max-w-md overflow-y-auto rounded border border-slate-200 p-2">
                {visibleCourses.map((c) => (
                  <label key={c.code} className="flex items-center gap-2 py-0.5 text-xs text-slate-700">
                    <input type="checkbox" checked={selectedCourses.includes(c.code)} onChange={() => toggleCourse(c.code)} />
                    <span className="font-medium">{c.code}</span>
                    <span className="text-slate-500">{c.title}</span>
                  </label>
                ))}
                {visibleCourses.length === 0 && <p className="text-xs text-slate-400">No matching courses.</p>}
                {pickerHint && (
                  <button
                    type="button"
                    onClick={handlePickerAdd}
                    className="mt-1 rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-800 hover:bg-blue-100"
                  >
                    Add {pickerHint.code}{pickerHint.found && pickerHint.title ? ` — ${pickerHint.title}` : ' (not in catalog)'}
                  </button>
                )}
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={canCreate} onChange={(e) => setCanCreate(e.target.checked)} />
            Can also add new courses
          </label>
        </div>

        <button
          onClick={create}
          disabled={pending}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add faculty'}
        </button>

        {error && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        {minted && (
          <div className="space-y-2 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm">
            <p className="font-medium text-green-800">Copy this link now — it won&apos;t be shown again.</p>
            <code className="block select-all break-all text-xs text-green-900">{minted.link}</code>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copyLink(minted.link)}
                className="rounded border border-green-400 bg-white px-2 py-0.5 text-xs text-green-800 hover:bg-green-100"
              >
                {copied ? '✓ Copied' : 'Copy link'}
              </button>
              <a
                href={composeEmailHref(minted.grant, minted.link)}
                className="rounded border border-green-400 bg-white px-2 py-0.5 text-xs text-green-800 hover:bg-green-100"
              >
                Compose email
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-700">Everyone with access ({visibleGrants.length})</h3>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} />
            Show revoked
          </label>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Courses</th>
              <th>Can add courses</th>
              <th>Expires</th>
              <th>Last used</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleGrants.map((g) => (
              <AccessRow
                key={g.id}
                grant={g}
                courses={courseOptions}
                editing={editingId === g.id}
                onEdit={() => setEditingId(g.id)}
                onCancelEdit={() => setEditingId(null)}
                onSave={(patch) => saveEdit(g.id, patch)}
                onReissue={() => reissue(g.id)}
                onRevoke={() => revoke(g.id)}
              />
            ))}
          </tbody>
        </table>
        {visibleGrants.length === 0 && <p className="text-sm text-slate-500">No one has access yet. Add the first person above.</p>}
      </div>
    </section>
  );
}

function AccessRow({
  grant, courses, editing, onEdit, onCancelEdit, onSave, onReissue, onRevoke,
}: {
  grant: AccessGrant;
  courses: AccessCourse[];
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: Record<string, unknown>) => void;
  onReissue: () => void;
  onRevoke: () => void;
}) {
  const [label, setLabel] = useState(grant.label);
  const [email, setEmail] = useState(grant.email ?? '');
  const [allCourses, setAllCourses] = useState(grant.scope.includes('*'));
  const [selectedCourses, setSelectedCourses] = useState<string[]>(grant.scope.includes('*') ? [] : grant.scope);
  const [canCreate, setCanCreate] = useState(grant.can.includes('create'));
  const [expiresAt, setExpiresAt] = useState(grant.expiresAt ? grant.expiresAt.slice(0, 10) : '');

  if (editing) {
    return (
      <tr className="border-t border-slate-200 bg-slate-50">
        <td colSpan={8} className="py-3">
          <div className="flex flex-wrap items-end gap-3">
            <input className="rounded border border-slate-300 px-2 py-1 text-sm" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Edit name" />
            <input className="rounded border border-slate-300 px-2 py-1 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Edit email" />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={allCourses} onChange={(e) => setAllCourses(e.target.checked)} />
              All courses
            </label>
            {!allCourses && (
              <select
                multiple
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                value={selectedCourses}
                onChange={(e) => setSelectedCourses(Array.from(e.target.selectedOptions).map((o) => o.value))}
                aria-label="Edit courses"
              >
                {courses.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            )}
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={canCreate} onChange={(e) => setCanCreate(e.target.checked)} />
              Can also add new courses
            </label>
            <input type="date" className="rounded border border-slate-300 px-2 py-1 text-xs" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} aria-label="Edit expires" />
            <button
              type="button"
              className="rounded bg-slate-800 px-3 py-1 text-xs text-white"
              onClick={() => onSave({
                label,
                email: email.trim() || null,
                courses: allCourses ? '*' : selectedCourses,
                canCreate,
                expiresAt: expiresAt || null,
              })}
            >
              Save
            </button>
            <button type="button" className="rounded border border-slate-300 px-3 py-1 text-xs" onClick={onCancelEdit}>Cancel</button>
          </div>
        </td>
      </tr>
    );
  }

  const revoked = grant.status === 'revoked';
  // CLI-minted admin grants are read-only in the panel (fix round 1, L1):
  // the server refuses to edit or reissue them (409 "managed from the
  // command line"), so disable those two actions here too rather than
  // letting the admin discover it only after a failed click. Revoke stays
  // enabled — killing access is always safe.
  const adminManaged = grant.can.includes('admin');
  return (
    <tr className={`border-t border-slate-200 ${revoked ? 'opacity-50' : ''}`}>
      <td className="py-2 font-medium">{grant.label}</td>
      <td className="text-slate-600">{grant.email ?? <span className="text-slate-400">—</span>}</td>
      <td className="text-xs">{grant.scope.includes('*') ? 'All courses' : grant.scope.join(', ')}</td>
      <td className="text-xs">{grant.can.includes('create') ? 'Yes' : 'No'}</td>
      <td className="text-xs">{grant.expiresAt ? new Date(grant.expiresAt).toLocaleDateString() : 'Never'}</td>
      <td className="text-xs">{grant.lastUsedAt ? new Date(grant.lastUsedAt).toLocaleDateString() : '—'}</td>
      <td className="text-xs">
        {grant.status}
        {adminManaged && <div className="text-slate-400">Managed from the command line</div>}
      </td>
      <td>
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" disabled={revoked || adminManaged} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40" onClick={onEdit}>Edit</button>
          <button type="button" disabled={revoked || adminManaged} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40" onClick={onReissue}>Send a new link</button>
          <button type="button" disabled={revoked} className="rounded border border-slate-300 px-2 py-0.5 text-red-700 disabled:opacity-40" onClick={onRevoke}>Revoke</button>
        </div>
      </td>
    </tr>
  );
}
