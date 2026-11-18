// Saved state of a course cluster map (spec 2026-11-17-course-cluster-map-design.md): skills only, no acts or terms.
// Shares its map-scoped fields (MapCore) with the plan map and reuses the plan schema's pieces unchanged.
import { z } from 'zod';
import type { MapCore } from '../types';
import { courseEditsRecordSchema, linkSchema, proposedSchema, versionsSchema } from '../plan-schema';

export interface ClusterCard { ref: string; x: number; y: number }
export interface ClusterObjective { id: string; text: string }
/** A faculty reading of one match. `targetKey`: `req:<courseRef>|<requiredRef>`, `obj:<courseRef>|<hash(normalized text)>`, or `cobj:<objective id>`. */
export interface ClusterOverride {
  targetKey: string; textHash: string; label: 'met' | 'partly' | 'not'; by: string; at: string; reason: string | null;
}
export interface ClusterState extends MapCore {
  cards: ClusterCard[];
  objectives: ClusterObjective[];
  overrides: ClusterOverride[];
}

const id = z.string().min(1).max(80);
const coord = z.number().finite().min(0).max(20000);

export const clusterStateSchema = z.object({
  cards: z.array(z.object({ ref: id, x: coord, y: coord })).max(40),
  objectives: z.array(z.object({ id, text: z.string().max(500) })).max(20),
  overrides: z.array(z.object({
    targetKey: z.string().min(1).max(200), textHash: z.string().max(200), label: z.enum(['met', 'partly', 'not']),
    by: z.string().max(120), at: z.string().max(40), reason: z.string().max(1000).nullable(),
  })).max(300),
  proposed: proposedSchema,
  courseEdits: courseEditsRecordSchema.optional(),
  versions: versionsSchema,
  links: z.array(linkSchema).max(300),
  unlinked: z.array(linkSchema).max(300),
});

export function parseClusterState(input: unknown): ClusterState | null {
  const r = clusterStateSchema.safeParse(input);
  return r.success ? (r.data as ClusterState) : null;
}

export function emptyClusterState(): ClusterState {
  return { cards: [], objectives: [], overrides: [], proposed: [], versions: {}, links: [], unlinked: [] };
}

/**
 * A cluster's saved state as the page opens it: a missing state is an empty cluster, fields a newer build added are
 * filled from the empty cluster, and anything that still cannot be read is null (the page then refuses to open it
 * rather than let the first edit overwrite it).
 */
export function readClusterState(stored: unknown): ClusterState | null {
  if (stored == null) return emptyClusterState();
  if (typeof stored !== 'object' || Array.isArray(stored)) return null;
  return parseClusterState({ ...emptyClusterState(), ...stored });
}
