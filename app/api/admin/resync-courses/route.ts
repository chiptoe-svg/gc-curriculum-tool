import { NextResponse } from 'next/server';

// Course data is now sourced from the Clemson catalog seed script
// (pnpm db:seed-courses). Google Sheets sync was retired after Build 0.
// This route is preserved for reference but no longer functional.
export async function POST() {
  return NextResponse.json(
    {
      error: 'This endpoint has been retired. Course data is now managed via the catalog seed script (pnpm db:seed-courses) and the course intake UI.',
    },
    { status: 410 },
  );
}
