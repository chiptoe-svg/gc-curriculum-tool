import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { getCluster } from '@/lib/db/cluster-queries';
import { createWhatIf } from '@/lib/db/what-if-queries';
import { loadLibrary } from '@/lib/builder/library';
import { clusterVersionOf, whatIfOf } from '@/lib/builder/compute';
import { effectiveCourse } from '@/lib/builder/edits';
import { emptyClusterState, parseClusterState } from '@/lib/builder/cluster/state';
import { NAME_MAX } from '@/lib/builder/plan-schema';
import { ownerOf } from '@/lib/what-if/ownership';
import type { WhatIfSkills } from '@/lib/what-if/types';

interface Ctx { params: Promise<{ id: string }> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * POST /api/build/clusters/[id]/versions
 * Body: { courseRef, authorName? }. Saves the course as edited on this cluster as a skills-only what-if on that
 * course (no estimate or profile; `fromCluster` names this cluster). It is based on the capture the cluster uses
 * for the course. Only a tracked course with a captured version can be saved. A course read from a skills-only what-if
 * is saved with that what-if's skills plus the edits, based on the what-if's own base capture; when that capture is
 * gone it is refused.
 * → 201 { id, title } | 400 | 404
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return bad('not found', 404);
  let body: { courseRef?: unknown; authorName?: unknown } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === 'object') body = parsed;
  } catch { /* handled below */ }
  const courseRef = typeof body.courseRef === 'string' ? body.courseRef : '';
  if (!courseRef) return bad('Pick the course to save.');
  const authorName = personalName(auth.grant)
    ?? (typeof body.authorName === 'string' ? body.authorName.trim().slice(0, NAME_MAX) : '');
  if (!authorName) return bad('A name is required.');

  const [cluster, lib] = await Promise.all([getCluster(id), loadLibrary()]);
  if (!cluster) return bad('not found', 404);
  const state = parseClusterState({ ...emptyClusterState(), ...(cluster.state as object) });
  if (!state) return bad('The cluster could not be read.', 422);

  if (!state.cards.some(c => c.ref === courseRef)) return bad('That course is not on this cluster.');
  const lc = lib.courses.find(c => c.code === courseRef);
  if (!lc) return bad('Only a tracked course can be saved as a version.');
  const chosen = whatIfOf(lc, state);
  const skillsOnly = chosen?.skills ? chosen : null;
  if (skillsOnly && !lc.versions.some(v => v.snapshotId === skillsOnly.baseSnapshotId)) {
    return bad("This version's base capture is gone; it can't be saved again.");
  }
  const version = clusterVersionOf(lc, state);
  if (!version) return bad('This course has no captured version to save from.');

  const eff = effectiveCourse(lc, version, state.courseEdits?.[courseRef]);
  const skills: WhatIfSkills = {
    objectives: eff.objectives.map(o => o.text),
    developed: eff.developed.map(s => ({ statement: s.statement, k: s.k, u: s.u, d: s.d })),
    required: eff.required.map(r => ({ statement: r.statement, need: { k: r.need.k, u: r.need.u, d: r.need.d } })),
    fromCluster: id,
  };
  const title = `${lc.code} as edited on ${cluster.name}`;
  const row = await createWhatIf({
    courseCode: lc.code, baseSnapshotId: skillsOnly ? skillsOnly.baseSnapshotId! : version.snapshotId, ...ownerOf(auth.grant), authorName, title, skills,
  });
  return NextResponse.json({ id: row.id, title }, { status: 201 });
}
