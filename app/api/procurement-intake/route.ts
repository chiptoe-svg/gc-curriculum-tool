/**
 * Public intake endpoint for the sibling ask_procurement SME questionnaire
 * (served at /sme-questions.html). Accepts a multipart POST of the answers
 * (JSON string) plus optional uploaded policy files, and writes them to disk
 * under the ask_procurement intake directory. No faculty data; public on purpose
 * (allowlisted in lib/auth/basic-auth.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';

const INTAKE_DIR =
  process.env.AQ_INTAKE_DIR ?? '/Users/admin/projects/ask_procurement/intake';
const MAX_FILE = 25 * 1024 * 1024; // 25 MB per file
const MAX_FILES = 6;
const MAX_ANSWERS = 200_000; // chars

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const answers = form.get('answers');
    if (typeof answers !== 'string' || answers.trim().length === 0) {
      return NextResponse.json({ ok: false, error: 'no answers provided' }, { status: 400 });
    }
    if (answers.length > MAX_ANSWERS) {
      return NextResponse.json({ ok: false, error: 'answers too large' }, { status: 413 });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const id = `${stamp}-${randomUUID().slice(0, 8)}`;
    const dir = join(INTAKE_DIR, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'answers.txt'), answers, 'utf-8');

    const uploads = form
      .getAll('file')
      .filter((f): f is File => f instanceof File && f.size > 0)
      .slice(0, MAX_FILES);

    let filesSaved = 0;
    for (const f of uploads) {
      if (f.size > MAX_FILE) continue;
      const safe = (f.name || 'upload').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'upload.bin';
      const buf = Buffer.from(await f.arrayBuffer());
      await writeFile(join(dir, safe), buf);
      filesSaved++;
    }

    return NextResponse.json({ ok: true, id, filesSaved });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
