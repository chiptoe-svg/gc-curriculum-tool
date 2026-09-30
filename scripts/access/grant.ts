/** Usage: pnpm access:grant "<label>" --courses "GC 3730[,…]|*" --can capture[,create,admin] (--days N | --no-expiry)
 *  Prints the link ONCE. Run with the deploy env: pnpm exec tsx --env-file=.env.local scripts/access/grant.ts … */
import { db } from '@/lib/db/client';
import { accessGrants, courses } from '@/lib/db/schema';
import { newToken, hashToken } from '@/lib/auth/grants';
import { parseGrantArgs, checkCourses } from './lib';

async function main() {
  const args = parseGrantArgs(process.argv.slice(2));
  const known = (await db.select({ code: courses.code }).from(courses)).map(r => r.code);
  const unknown = checkCourses(args.scope, known);
  if (unknown.length) throw new Error(`not in the roster: ${unknown.join(', ')} — add the course first or fix the code`);
  const token = newToken();
  const [row] = await db.insert(accessGrants).values({ tokenHash: hashToken(token), label: args.label, scope: args.scope, can: args.can, expiresAt: args.expiresAt }).returning({ id: accessGrants.id });
  const origin = process.env.PUBLIC_HTTPS_ORIGIN?.replace(/\/$/, '') || 'https://gcworkflow.clemson.edu:8443';
  console.log(`${origin}/?key=${token}`);
  console.error(`granted ${row!.id.slice(0, 8)}  ${args.label}  scope=${args.scope.join(',')}  can=${args.can.join(',')}  expires=${args.expiresAt?.toISOString() ?? 'never'}`);
  process.exit(0);
}
main().catch(e => { console.error('access:grant:', e instanceof Error ? e.message : e); process.exit(1); });
