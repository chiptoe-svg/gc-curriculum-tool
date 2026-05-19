'use client';

import { useTransition } from 'react';

export interface AdminPartnerRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  weight: number;
  invitedAt: string | null;
  lastActiveAt: string | null;
  active: boolean;
}

export function PartnersTable({ partners, slug }: { partners: AdminPartnerRow[]; slug: string }) {
  const [pending, start] = useTransition();

  async function resend(id: string) {
    start(async () => {
      const res = await fetch(`/api/admin/partners/${id}/resend-invite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) alert(`Resend failed: ${res.status}`);
      else alert('Invite re-sent.');
    });
  }

  if (partners.length === 0) {
    return <p className="text-sm text-slate-500">No partners yet. Import a CSV to invite the first batch.</p>;
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead className="text-left text-xs uppercase text-slate-500">
        <tr>
          <th className="py-2">Name</th>
          <th>Company</th>
          <th>Weight</th>
          <th>Invited</th>
          <th>Last active</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {partners.map(p => (
          <tr key={p.id} className="border-t border-slate-200">
            <td className="py-2">{p.firstName} {p.lastName}<div className="text-xs text-slate-500">{p.email}</div></td>
            <td>{p.company}</td>
            <td>{p.weight}</td>
            <td className="text-xs">{p.invitedAt ? new Date(p.invitedAt).toLocaleDateString() : '—'}</td>
            <td className="text-xs">{p.lastActiveAt ? new Date(p.lastActiveAt).toLocaleDateString() : '—'}</td>
            <td>{p.active ? <span className="text-green-700">active</span> : <span className="text-slate-500">off</span>}</td>
            <td>
              <button
                onClick={() => resend(p.id)}
                disabled={pending}
                className="text-xs text-blue-700 hover:underline disabled:opacity-50"
              >
                Resend invite
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
