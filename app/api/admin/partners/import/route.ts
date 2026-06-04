import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { parsePartnersCsv } from '@/lib/partners/csv';
import { createPartner, findPartnerByEmail, magicLinkUrl, logPartnerEvent } from '@/lib/partners/queries';

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const csv = typeof body.csv === 'string' ? body.csv : '';
  if (!csv) {
    return NextResponse.json({ error: 'csv body required' }, { status: 400 });
  }

  const parsed = parsePartnersCsv(csv);
  if (parsed.errors.length > 0 && parsed.rows.length === 0) {
    return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  }

  let inserted = 0;
  let skipped = 0;
  const createdPartners: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    company: string;
    magicLinkUrl: string;
  }> = [];

  for (const row of parsed.rows) {
    const existing = await findPartnerByEmail(row.email);
    if (existing) {
      skipped++;
      continue;
    }
    const created = await createPartner(row);
    inserted++;
    createdPartners.push({
      id: created.id,
      firstName: created.firstName,
      lastName: created.lastName,
      email: created.email,
      company: created.company,
      magicLinkUrl: magicLinkUrl(created),
    });
  }

  await logPartnerEvent(null, 'admin_imported_csv', {
    inserted, skipped,
    rowErrors: parsed.errors,
  });

  return NextResponse.json({
    inserted,
    skipped,
    errors: parsed.errors,
    createdPartners,
  });
}
