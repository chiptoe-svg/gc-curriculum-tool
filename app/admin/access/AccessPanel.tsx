'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';

export interface AccessCourse { code: string; title: string; }

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

  async function saveEdit(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/access/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...patch, slug }),
    });
    if (!res.ok) {
      alert(`Save failed: ${res.status}`);
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
      alert(`Send a new link failed: ${res.status}`);
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
      alert(`Revoke failed: ${res.status}`);
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
    if (!f) return courses;
    return courses.filter((c) => c.code.toLowerCase().includes(f) || c.title.toLowerCase().includes(f));
  }, [courses, courseFilter]);

  const visibleGrants = showRevoked ? grants : grants.filter((g) => g.status !== 'revoked');

  function toggleCourse(code: string) {
    setSelectedCourses((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  return (
    <section className="space-y-6 rounded-lg border border-slate-200 bg-white p-6">
      <div>
        <h2 className="text-lg font-semibold">Faculty access</h2>
        <p className="text-sm text-slate-600">
          Add a person, see who has access, change their courses, send a new link, or revoke.
        </p>
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
                courses={courses}
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
  return (
    <tr className={`border-t border-slate-200 ${revoked ? 'opacity-50' : ''}`}>
      <td className="py-2 font-medium">{grant.label}</td>
      <td className="text-slate-600">{grant.email ?? <span className="text-slate-400">—</span>}</td>
      <td className="text-xs">{grant.scope.includes('*') ? 'All courses' : grant.scope.join(', ')}</td>
      <td className="text-xs">{grant.can.includes('create') ? 'Yes' : 'No'}</td>
      <td className="text-xs">{grant.expiresAt ? new Date(grant.expiresAt).toLocaleDateString() : 'Never'}</td>
      <td className="text-xs">{grant.lastUsedAt ? new Date(grant.lastUsedAt).toLocaleDateString() : '—'}</td>
      <td className="text-xs">{grant.status}</td>
      <td>
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" disabled={revoked} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40" onClick={onEdit}>Edit</button>
          <button type="button" disabled={revoked} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40" onClick={onReissue}>Send a new link</button>
          <button type="button" disabled={revoked} className="rounded border border-slate-300 px-2 py-0.5 text-red-700 disabled:opacity-40" onClick={onRevoke}>Revoke</button>
        </div>
      </td>
    </tr>
  );
}
