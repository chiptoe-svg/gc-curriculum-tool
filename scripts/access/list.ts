import { db } from '@/lib/db/client';
import { accessGrants } from '@/lib/db/schema';
import { isLive } from '@/lib/auth/grants';
const f = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—');
async function main() {
  const rows = await db.select().from(accessGrants).orderBy(accessGrants.createdAt);
  console.log(['id', 'label', 'scope', 'can', 'expires', 'last used', 'status'].join('\t'));
  for (const r of rows) console.log([r.id.slice(0, 8), r.label, r.scope.join(','), r.can.join(','), f(r.expiresAt), f(r.lastUsedAt), r.revokedAt ? 'revoked' : isLive(r) ? 'live' : 'expired'].join('\t'));
  process.exit(0);
}
main().catch(e => { console.error('access:list:', e instanceof Error ? e.message : e); process.exit(1); });
