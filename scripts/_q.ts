import { db } from '../lib/db/client';
import { partners, careerTargets, partnerSubmissions } from '../lib/db/schema';
import { asc } from 'drizzle-orm';
async function main() {
  const cts = await db.select().from(careerTargets).orderBy(asc(careerTargets.displayOrder));
  console.log('CAREER TARGETS:', cts.length);
  for (const c of cts) console.log('  -', c.id, '|', c.name);
  const ps = await db.select().from(partners);
  console.log('PARTNERS:', ps.length);
  for (const p of ps) console.log('  -', p.firstName, p.lastName, '|', p.company, '| active=', p.active, '| token=', p.magicToken);
  const subs = await db.select().from(partnerSubmissions);
  console.log('SUBMISSIONS:', subs.length);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
