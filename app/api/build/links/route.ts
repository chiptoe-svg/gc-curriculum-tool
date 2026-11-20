import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { db } from '@/lib/db/client';
import { competencyRollups, courseCaptureSnapshots, skillCompetencyLinks, subCompetencies } from '@/lib/db/schema';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { NAME_MAX } from '@/lib/builder/plan-schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const level = (v: unknown) => (v === null ? null : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 5 ? v : undefined);
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

/**
 * POST /api/build/links — a faculty decision on a skill -> competency link or a roll-up
 * (spec docs/superpowers/specs/2026-11-15-skill-competency-links-design.md). Never changes a capture's skills.
 * Body: { action, snapshotId, competencyId, skillRef?, k?, u?, d?, authorName? }
 *   confirm | reject | reopen  — an existing link (skillRef)
 *   add                         — link a skill of this capture to a competency (confirmed, source faculty)
 *   rollup                      — set this competency's level by hand ({ k, u, d }, each 0–5 or null)
 *   rollup-clear                — back to the scorer's level
 * → 200 { ok: true } | 400 | 404
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  let body: Record<string, unknown> = {};
  try { const p = await req.json(); if (p && typeof p === 'object') body = p; } catch { /* handled below */ }
  const { action, snapshotId, competencyId, skillRef } = body as { action?: string; snapshotId?: string; competencyId?: string; skillRef?: string };
  if (typeof snapshotId !== 'string' || !UUID.test(snapshotId) || typeof competencyId !== 'string' || !competencyId) return bad('A capture and a competency are required.');
  const who = personalName(auth.grant) ?? (typeof body.authorName === 'string' && body.authorName.trim() ? body.authorName.trim().slice(0, NAME_MAX) : 'Department login');

  const [snap] = await db.select({ profile: courseCaptureSnapshots.profile }).from(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.id, snapshotId));
  const [comp] = await db.select({ id: subCompetencies.id }).from(subCompetencies).where(and(eq(subCompetencies.id, competencyId), eq(subCompetencies.retired, false)));
  if (!snap || !comp) return NextResponse.json({ error: 'That capture or competency does not exist.' }, { status: 404 });

  if (action === 'confirm' || action === 'reject' || action === 'reopen') {
    if (typeof skillRef !== 'string' || !skillRef) return bad('Which skill?');
    const status = action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'proposed';
    const done = await db.update(skillCompetencyLinks)
      .set(action === 'reopen' ? { status, decidedBy: null, decidedAt: null } : { status, decidedBy: who, decidedAt: sql`now()` })
      .where(and(eq(skillCompetencyLinks.snapshotId, snapshotId), eq(skillCompetencyLinks.skillRef, skillRef), eq(skillCompetencyLinks.competencyId, competencyId)))
      .returning({ s: skillCompetencyLinks.status });
    return done.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'No such link.' }, { status: 404 });
  }

  if (action === 'add') {
    if (typeof skillRef !== 'string' || !skillRef) return bad('Which skill?');
    // The statement comes from the capture itself, never from the request.
    const statements = ((snap.profile as { competencies?: Array<{ statement?: string }> } | null)?.competencies ?? []).map(c => (c.statement ?? '').trim()).filter(Boolean);
    const statement = statements.find(s => textHash(normalizeStatement(s)) === skillRef);
    if (!statement) return NextResponse.json({ error: 'That skill is not in this capture.' }, { status: 404 });
    await db.insert(skillCompetencyLinks).values({ snapshotId, skillRef, statement, competencyId, source: 'faculty', status: 'confirmed', decidedBy: who, decidedAt: sql`now()` })
      .onConflictDoUpdate({ target: [skillCompetencyLinks.snapshotId, skillCompetencyLinks.skillRef, skillCompetencyLinks.competencyId], set: { status: 'confirmed', decidedBy: who, decidedAt: sql`now()` } });
    return NextResponse.json({ ok: true });
  }

  if (action === 'rollup') {
    const k = level(body.k), u = level(body.u), d = level(body.d);
    if (k === undefined || u === undefined || d === undefined) return bad('Levels are whole numbers from 0 to 5, or blank.');
    await db.insert(competencyRollups).values({ snapshotId, competencyId, k, u, d, method: 'faculty', decidedBy: who })
      .onConflictDoUpdate({ target: [competencyRollups.snapshotId, competencyRollups.competencyId], set: { k, u, d, method: 'faculty', rationale: null, model: null, decidedBy: who, createdAt: sql`now()` } });
    return NextResponse.json({ ok: true });
  }

  if (action === 'rollup-clear') {
    await db.delete(competencyRollups).where(and(eq(competencyRollups.snapshotId, snapshotId), eq(competencyRollups.competencyId, competencyId)));
    return NextResponse.json({ ok: true });
  }
  return bad('Unknown action.');
}
