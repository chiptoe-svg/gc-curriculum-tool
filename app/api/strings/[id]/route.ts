import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import {
  branchString, extendString, loadGraph, mergeString, relockString, removePoint, renameString, setEndNote, setLinkWhy,
  unlockString, unmergeString, type WriteResult,
} from '@/lib/db/string-queries';
import { NAME_MAX } from '@/lib/builder/plan-schema';
import { loadLibrary } from '@/lib/builder/library';
import { anchorPoint, authorOf, bad, NOT_CAPTURED, overLongText, parsePoint, readBody, respond, str, subGraph, UUID, type Body } from '@/lib/strings/api';

interface Ctx { params: Promise<{ id: string }> }

/** GET /api/strings/[id] → { graph } for that string (unlocked included), or 404. */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return bad('String not found.', 404);
  const graph = subGraph(await loadGraph({ includeUnlocked: true }), id);
  if (!graph) return bad('String not found.', 404);
  return NextResponse.json({ graph });
}

const ACTIONS = ['extend', 'branch', 'merge', 'unmerge', 'remove-point', 'link-why', 'rename', 'end-note', 'unlock', 'relock'] as const;
type Action = (typeof ACTIONS)[number];

/**
 * PATCH /api/strings/[id]
 * Body: { action, version, authorName?, ...fields } where the fields depend on the action:
 *   extend { at: 'start'|'end', point, why }   branch { atPosition, name, description?, point, why }
 *   merge { into, reason }   unmerge { reason }   remove-point { position, reason }   link-why { linkId, why }
 *   rename { name }   end-note { note|null }   unlock { reason }   relock {}
 * → 200 { graph, notes } | 400 | 404 | 409 { error, current? } (a stale version carries the string as it stands now).
 */
export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return bad('String not found.', 404);
  const body = await readBody(req);
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) return bad('Unknown action.');
  const by = authorOf(auth.grant, body);
  if (!by) return bad('A name is required.');
  const long = overLongText(body);
  if (long) return bad(long);
  const version = body.version;
  const needsVersion = action !== 'link-why';
  if (needsVersion && (typeof version !== 'number' || !Number.isInteger(version))) return bad('The string version is required.');
  const v = version as number;
  const run = await dispatch(action, id, v, by, body);
  return run instanceof Response ? run : respond(run);
}

async function dispatch(action: Action, id: string, version: number, by: string, b: Body): Promise<WriteResult | Response> {
  const reason = str(b.reason)?.trim();
  switch (action) {
    case 'extend': {
      const parsed = parsePoint(b.point);
      const why = str(b.why);
      if (b.at !== 'start' && b.at !== 'end') return bad('Say whether to extend at the start or the end.');
      if ('error' in parsed) return bad(parsed.error);
      if (!why) return bad('A reason for the link is required.');
      const point = anchorPoint(parsed.point, await loadLibrary());
      if (!point) return bad(NOT_CAPTURED);
      return extendString({ id, version, at: b.at, point, why, by });
    }
    case 'branch': {
      const parsed = parsePoint(b.point);
      const name = str(b.name)?.trim().slice(0, NAME_MAX);
      const why = str(b.why);
      if (typeof b.atPosition !== 'number' || !Number.isInteger(b.atPosition)) return bad('Say which skill to branch from.');
      if (!name) return bad('A string needs a name.');
      if ('error' in parsed) return bad(parsed.error);
      if (!why) return bad('A reason for the link is required.');
      const point = anchorPoint(parsed.point, await loadLibrary());
      if (!point) return bad(NOT_CAPTURED);
      return branchString({ fromId: id, version, atPosition: b.atPosition, name, description: typeof b.description === 'string' ? b.description.trim() : '', point, why, by });
    }
    case 'merge': {
      const into = str(b.into);
      if (!into) return bad('Say which string to merge into.');
      if (!UUID.test(into)) return bad('String not found.', 404);
      if (!reason) return bad('A reason is required.');
      return mergeString({ id, version, into, reason, by });
    }
    case 'unmerge':
      if (!reason) return bad('A reason is required.');
      return unmergeString({ id, version, reason, by });
    case 'remove-point':
      if (typeof b.position !== 'number' || !Number.isInteger(b.position)) return bad('Say which skill to remove.');
      if (!reason) return bad('A reason is required.');
      return removePoint({ id, version, position: b.position, reason, by });
    case 'link-why': {
      const linkId = str(b.linkId);
      const why = str(b.why);
      if (!linkId || !UUID.test(linkId)) return bad('Say which link to change.');
      if (!why) return bad('A reason for the link is required.');
      return setLinkWhy({ linkId, why, by });
    }
    case 'rename': {
      const name = str(b.name)?.trim().slice(0, NAME_MAX);
      if (!name) return bad('A string needs a name.');
      return renameString({ id, version, name, by });
    }
    case 'end-note':
      if (b.note !== null && typeof b.note !== 'string') return bad('The note must be text, or null to clear it.');
      return setEndNote({ id, version, note: b.note, by });
    case 'unlock':
      if (!reason) return bad('A reason is required.');
      return unlockString({ id, version, reason, by });
    case 'relock':
      return relockString({ id, version, by });
  }
}
