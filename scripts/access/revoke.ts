/** Usage: pnpm access:revoke <id or id-prefix> */
import { sql, eq, isNull, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { accessGrants } from '@/lib/db/schema';
async function main() {
  const prefix = process.argv[2];
  if (!prefix || prefix.length < 6) throw new Error('give at least 6 characters of the id (see access:list)');
  const matches = await db.select({ id: accessGrants.id, label: accessGrants.label }).from(accessGrants).where(and(sql`${accessGrants.id}::text LIKE ${prefix + '%'}`, isNull(accessGrants.revokedAt)));
  if (matches.length !== 1) throw new Error(matches.length === 0 ? 'no live grant with that id' : 'prefix matches more than one grant — use more characters');
  await db.update(accessGrants).set({ revokedAt: new Date() }).where(eq(accessGrants.id, matches[0]!.id));
  console.log(`revoked ${matches[0]!.id.slice(0, 8)}  ${matches[0]!.label}`);
  process.exit(0);
}
main().catch(e => { console.error('access:revoke:', e instanceof Error ? e.message : e); process.exit(1); });
