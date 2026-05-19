import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { listPartners } from '@/lib/partners/queries';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const rows = await listPartners();
  // Strip magicToken — never expose tokens in the list view.
  const safe = rows.map(({ magicToken, ...rest }) => rest);
  return NextResponse.json({ partners: safe });
}
