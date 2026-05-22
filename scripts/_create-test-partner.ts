/**
 * Scratch script: create a clearly-labeled test partner for pre-testing the
 * Industry Partner Input survey UI. No invite email is sent — just a DB row.
 * Idempotent on the test email: re-running reuses the existing row.
 * Safe to delete this file (and the row) afterward.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load .env.local into process.env before importing anything that reads it.
const envText = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const TEST_EMAIL = 'pretest+industry@example.com';

async function main() {
  const { findPartnerByEmail, createPartner } = await import('../lib/partners/queries');
  const existing = await findPartnerByEmail(TEST_EMAIL);
  const partner = existing ?? (await createPartner({
    email: TEST_EMAIL,
    firstName: 'Pre-Test',
    lastName: 'Partner',
    company: 'Test Co. (delete me)',
    roleTitle: 'UI evaluation',
    weight: 1,
    careerTargetHints: [],
  }));
  console.log(existing ? 'REUSED existing test partner' : 'CREATED test partner');
  console.log('id:    ', partner.id);
  console.log('token: ', partner.magicToken);
  console.log('URL:   ', `http://localhost:3000/partners/${partner.magicToken}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
