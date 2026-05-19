import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { parsePartnersCsv } from '@/lib/partners/csv';
import { createPartner, findPartnerByEmail, markInvited, logPartnerEvent } from '@/lib/partners/queries';
import { sendPartnerInvite } from '@/lib/email/send-partner-invite';

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
  const sendFailures: Array<{ email: string; message: string }> = [];

  for (const row of parsed.rows) {
    const existing = await findPartnerByEmail(row.email);
    if (existing) {
      skipped++;
      continue;
    }
    const created = await createPartner(row);
    inserted++;
    try {
      await sendPartnerInvite({
        firstName: created.firstName,
        email: created.email,
        token: created.magicToken,
      });
      await markInvited(created.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendFailures.push({ email: created.email, message: msg });
    }
  }

  await logPartnerEvent(null, 'admin_imported_csv', {
    inserted, skipped,
    rowErrors: parsed.errors,
    sendFailures,
  });

  return NextResponse.json({
    inserted,
    skipped,
    errors: parsed.errors,
    sendFailures,
  });
}
