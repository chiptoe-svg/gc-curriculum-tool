import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { exportDecisions } from '@/lib/db/match-queries';
import { toCsv, toJsonl, toRecords } from '@/lib/db/match-export';

/**
 * GET /api/build/match-decisions?format=jsonl|csv&latest=1 — the labeled-pair dataset (one record per faculty decision).
 * `latest=1` keeps the decision that counts for each pair (newest non-draft) plus draft decisions as their own rows.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const url = new URL(req.url);
  const format = url.searchParams.get('format') ?? 'jsonl';
  if (format !== 'jsonl' && format !== 'csv') return NextResponse.json({ error: 'format must be jsonl or csv.' }, { status: 400 });
  const latestOnly = ['1', 'true'].includes(url.searchParams.get('latest') ?? '');
  const recs = toRecords(await exportDecisions({ latestOnly }));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(format === 'csv' ? toCsv(recs) : toJsonl(recs), {
    headers: {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="match-decisions-${day}.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
}
