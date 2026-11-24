/**
 * Public sign-up endpoint for the Godfrey Hall tours (Dec 1–2, 2026),
 * served with the page at /tours/signup.html. GET returns who has signed
 * up; POST {name, tue, wed} adds a name, or updates the choices of the
 * same name (case-insensitive). Stored as one JSON file outside the deploy
 * checkout. Students' names only; public on purpose (owner 2026-11-24),
 * allowlisted in lib/auth/basic-auth.ts. Campus network only, like the app.
 */
import { NextRequest, NextResponse } from 'next/server';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILE = process.env.TOUR_SIGNUPS_FILE ?? '/Users/admin/projects/tour-signups/signups.json';
const MAX_ROWS = 500;

export interface Signup { name: string; tue: boolean; wed: boolean; at: string }

async function readRows(): Promise<Signup[]> {
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

async function writeRows(rows: Signup[]): Promise<void> {
  await mkdir(dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(rows, null, 2), 'utf-8');
  await rename(tmp, FILE); // atomic: the file is always the old list or the new one
}

const publicRows = (rows: Signup[]) => rows.map(({ name, tue, wed }) => ({ name, tue, wed }));

// One write at a time inside this process, so two submits can't drop each other.
let queue: Promise<unknown> = Promise.resolve();

export async function GET() {
  try {
    return NextResponse.json({ ok: true, rows: publicRows(await readRows()) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not load the list.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let d: { name?: unknown; tue?: unknown; wed?: unknown };
  try {
    d = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not read the form.' }, { status: 400 });
  }
  const name = String(d.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const tue = d.tue === true;
  const wed = d.wed === true;
  if (!tue && !wed) return NextResponse.json({ ok: false, error: 'Pick at least one tour.' }, { status: 400 });
  if (!name) return NextResponse.json({ ok: false, error: 'Please enter your name.' }, { status: 400 });

  const run = queue.then(async () => {
    const rows = await readRows();
    const row: Signup = { name, tue, wed, at: new Date().toISOString() };
    const i = rows.findIndex(r => r.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) rows[i] = row;
    else if (rows.length >= MAX_ROWS) return { full: true as const, rows };
    else rows.push(row);
    await writeRows(rows);
    return { full: false as const, rows };
  });
  queue = run.catch(() => undefined);

  try {
    const result = await run;
    if (result.full) return NextResponse.json({ ok: false, error: 'The sign-up list is full.' }, { status: 409 });
    return NextResponse.json({ ok: true, rows: publicRows(result.rows) });
  } catch {
    return NextResponse.json({ ok: false, error: 'That did not save. Try again.' }, { status: 500 });
  }
}
