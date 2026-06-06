'use client';

import { useState, useTransition } from 'react';

const EMPTY = { firstName: '', lastName: '', email: '', company: '', roleTitle: '', careerTargetHint: '', weight: '1' };

export function AddPartnerDialog({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function close() {
    setOpen(false);
    setError(null);
    setForm({ ...EMPTY });
  }

  function submit() {
    setError(null);
    if (!form.firstName.trim() || !form.email.trim() || !form.company.trim()) {
      setError('First name, email, and company are required.');
      return;
    }
    start(async () => {
      const res = await fetch('/api/admin/partners/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          company: form.company.trim(),
          roleTitle: form.roleTitle.trim() || null,
          careerTargetHints: form.careerTargetHint.trim() ? [form.careerTargetHint.trim()] : [],
          weight: Number(form.weight) || 1,
        }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      const json = await res.json().catch(() => ({})) as { error?: string };
      setError(json.error ?? `Failed to add partner (${res.status})`);
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded bg-slate-800 px-4 py-2 text-sm text-white">
        + Add partner
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-3 rounded bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add a partner</h2>
          <button onClick={close} className="text-slate-500">✕</button>
        </div>
        <p className="text-xs text-slate-600">
          Creates the partner and mints their survey link. Send it from the new row&apos;s
          <strong> Copy link</strong> / <strong>Compose email</strong> buttons.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input className="rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="First name *" value={form.firstName} onChange={e => set('firstName', e.target.value)} />
          <input className="rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Last name" value={form.lastName} onChange={e => set('lastName', e.target.value)} />
        </div>
        <input className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Email *" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
        <input className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Company *" value={form.company} onChange={e => set('company', e.target.value)} />
        <input className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Role title (optional)" value={form.roleTitle} onChange={e => set('roleTitle', e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className="rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Career-target hint (opt.)" value={form.careerTargetHint} onChange={e => set('careerTargetHint', e.target.value)} />
          <input className="rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Weight" type="number" min={0} value={form.weight} onChange={e => set('weight', e.target.value)} />
        </div>
        {error && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={close} className="text-sm text-slate-600">Cancel</button>
          <button onClick={submit} disabled={pending} className="rounded bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">
            {pending ? 'Adding…' : 'Add partner'}
          </button>
        </div>
      </div>
    </div>
  );
}
