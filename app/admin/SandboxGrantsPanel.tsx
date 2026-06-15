'use client';

import { useState, useEffect, useTransition } from 'react';

interface Grant {
  id: string;
  token: string;
  courseCode: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  active: boolean;
  revokedAt: string | null;
}

export interface SandboxCourse { code: string; title: string; }

export function SandboxGrantsPanel({ slug, sandboxCourses }: { slug: string; sandboxCourses: SandboxCourse[] }) {
  // Admin second factor: present the slug as a Bearer token (the preferred
  // path in lib/auth/admin-auth.ts — keeps the secret out of the query string).
  const authHeaders = { Authorization: `Bearer ${slug}` };
  const [grants, setGrants] = useState<Grant[]>([]);
  const [label, setLabel] = useState('');
  const [minted, setMinted] = useState<{ url: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);

  async function loadGrants() {
    const res = await fetch('/api/admin/sandbox-grants', { headers: authHeaders });
    if (res.ok) {
      const json = await res.json() as { grants: Grant[] };
      setGrants(json.grants);
    }
  }

  useEffect(() => { void loadGrants(); }, []);

  function mint() {
    setError(null);
    setMinted(null);
    start(async () => {
      const res = await fetch('/api/admin/sandbox-grants', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ label: label.trim() || null }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        setError(json.error ?? `Failed to mint grant (${res.status})`);
        return;
      }
      const json = await res.json() as { token: string };
      const url = `${window.location.origin}/sandbox/${json.token}`;
      setMinted({ url, token: json.token });
      setLabel('');
      await loadGrants();
    });
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/admin/sandbox-grants?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders });
    if (!res.ok) {
      alert(`Revoke failed: ${res.status}`);
      return;
    }
    await loadGrants();
  }

  async function copyUrl(url: string) {
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

  const active = grants.filter(g => g.active && !g.revokedAt && new Date(g.expiresAt).getTime() > Date.now());
  const inactive = grants.filter(g => !g.active || g.revokedAt || new Date(g.expiresAt).getTime() <= Date.now());

  return (
    <section className="space-y-6 rounded-lg border border-slate-200 bg-white p-6">
      <div>
        <h2 className="text-lg font-semibold">Sandbox access</h2>
        <p className="text-sm text-slate-600">
          Mint a generic invite link for an external tester. They open it, enter their own course
          (code + title) + name, and capture it in an isolated sandbox (link valid 30 days). Revoke any time.
        </p>
      </div>

      {/* Mint form */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-slate-700">Mint an invite link</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Label (optional — who it's for)</label>
            <input
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="UGA pilot"
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
          </div>
          <button
            onClick={mint}
            disabled={pending}
            className="rounded bg-slate-800 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {pending ? 'Minting…' : 'Mint link'}
          </button>
        </div>
        {error && (
          <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        )}
        {minted && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm">
            <span className="font-medium text-green-800">Link minted:</span>
            <code className="select-all break-all text-xs text-green-900">{minted.url}</code>
            <button
              onClick={() => copyUrl(minted.url)}
              className="rounded border border-green-400 bg-white px-2 py-0.5 text-xs text-green-800 hover:bg-green-100"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>

      {/* Active grants */}
      {active.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-slate-700">Active grants ({active.length})</h3>
          <table className="w-full border-collapse text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Course</th>
                <th>Label</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map(g => (
                <tr key={g.id} className="border-t border-slate-200">
                  <td className="py-2 font-medium">{g.courseCode}</td>
                  <td className="text-slate-600">{g.label ?? <span className="text-slate-400">—</span>}</td>
                  <td className="text-xs text-slate-500">{new Date(g.expiresAt).toLocaleDateString()}</td>
                  <td>
                    <button
                      onClick={() => revoke(g.id)}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Inactive / revoked grants */}
      {inactive.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-slate-500">Revoked / expired ({inactive.length})</h3>
          <table className="w-full border-collapse text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Course</th>
                <th>Label</th>
                <th>Expired / revoked</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {inactive.map(g => (
                <tr key={g.id} className="border-t border-slate-200 opacity-60">
                  <td className="py-2">{g.courseCode}</td>
                  <td>{g.label ?? '—'}</td>
                  <td className="text-xs">
                    {g.revokedAt
                      ? `Revoked ${new Date(g.revokedAt).toLocaleDateString()}`
                      : `Expired ${new Date(g.expiresAt).toLocaleDateString()}`}
                  </td>
                  <td>
                    <span className="text-xs text-slate-500">
                      {g.revokedAt ? 'revoked' : 'expired'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {grants.length === 0 && (
        <p className="text-sm text-slate-500">No grants yet. Mint the first one above.</p>
      )}

      {/* Sandbox courses testers have created — the operator's review list. */}
      <div className="space-y-2 border-t border-slate-200 pt-5">
        <h3 className="text-sm font-medium text-slate-700">Sandbox courses created by testers ({sandboxCourses.length})</h3>
        {sandboxCourses.length === 0 ? (
          <p className="text-sm text-slate-500">None yet — they appear here once a tester opens a link and names their course.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr><th className="py-2">Course</th><th></th></tr>
            </thead>
            <tbody>
              {sandboxCourses.map(c => (
                <tr key={c.code} className="border-t border-slate-200">
                  <td className="py-2 font-medium">{c.title}</td>
                  <td className="flex gap-3 py-2">
                    <a className="text-blue-700 underline" href={`/view/${encodeURIComponent(c.code)}?slug=${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer">View profile</a>
                    <a className="text-blue-700 underline" href={`/capture/${encodeURIComponent(c.code)}?slug=${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer">Review in capture</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
