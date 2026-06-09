'use client';

export interface AdminPartnerRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  weight: number;
  invitedAt: string | null;
  firstOpenedAt: string | null;
  lastActiveAt: string | null;
  draftCount: number;
  submittedCount: number;
  active: boolean;
  magicLinkUrl: string;
}

export function PartnersTable({ partners, slug }: { partners: AdminPartnerRow[]; slug: string }) {
  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for non-secure contexts (we shouldn't hit this since
      // /admin is on the HTTPS funnel — but be defensive)
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); }
      finally { document.body.removeChild(ta); }
    }
  }

  function composeEmailHref(partner: AdminPartnerRow, magicLink: string): string {
    const subject = `Your GC industry input — 15-min survey link`;
    const body = [
      `Hi ${partner.firstName},`,
      '',
      `Thanks for being willing to share your perspective on what ${partner.company} looks for in entry-level graphic-communications hires. The survey takes ~15 minutes and helps us audit how well the GC curriculum is preparing students for roles like yours.`,
      '',
      `Your personal link:`,
      magicLink,
      '',
      `If you hire for more than one kind of role, you can describe each through this same link — after you finish one, just start another.`,
      '',
      `Let me know if you have any trouble accessing it.`,
      '',
      `— Chip`,
    ].join('\n');
    return `mailto:${encodeURIComponent(partner.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function markInvited(partnerId: string) {
    const res = await fetch(`/api/admin/partners/${partnerId}/mark-invited`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    if (!res.ok) {
      alert(`Mark-invited failed: ${res.status}`);
      return;
    }
    window.location.reload();
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
          <th>Opened</th>
          <th title="Started but not yet submitted">Drafts</th>
          <th title="Completed positions">Submitted</th>
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
            <td className="text-xs">{p.firstOpenedAt ? new Date(p.firstOpenedAt).toLocaleDateString() : '—'}</td>
            <td className="text-xs">{p.draftCount > 0 ? <span className="text-amber-700">{p.draftCount}</span> : <span className="text-slate-400">—</span>}</td>
            <td className="text-xs">{p.submittedCount > 0 ? <span className="font-medium text-green-700">{p.submittedCount}</span> : <span className="text-slate-400">—</span>}</td>
            <td className="text-xs">{p.lastActiveAt ? new Date(p.lastActiveAt).toLocaleDateString() : '—'}</td>
            <td>{p.active ? <span className="text-green-700">active</span> : <span className="text-slate-500">off</span>}</td>
            <td>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => copyLink(p.magicLinkUrl)}
                  className="rounded border border-input bg-background px-2 py-1 hover:bg-muted"
                  title="Copy the magic-link URL to your clipboard"
                >
                  Copy link
                </button>
                <a
                  href={composeEmailHref(p, p.magicLinkUrl)}
                  className="rounded border border-input bg-background px-2 py-1 hover:bg-muted"
                  title="Opens your default email client with a draft you can edit before sending"
                >
                  Compose email
                </a>
                <button
                  type="button"
                  onClick={() => markInvited(p.id)}
                  disabled={!!p.invitedAt}
                  className="rounded border border-input bg-background px-2 py-1 hover:bg-muted disabled:opacity-50"
                  title={p.invitedAt ? `Marked invited ${new Date(p.invitedAt).toLocaleDateString()}` : 'Record that you sent the invite'}
                >
                  {p.invitedAt ? '✓ Invited' : 'Mark invited'}
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
