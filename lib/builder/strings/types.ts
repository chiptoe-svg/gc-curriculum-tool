import type { Act, Depth } from '../types';

export type Role = 'develops' | 'requires';

export interface PointRow {
  id: string;
  courseCode: string;
  role: Role;
  statement: string;
  statementHash: string;
  snapshotId: string | null;
  k: number | null;
  u: number | null;
  d: number | null;
  term: number | null;
  /** A requires point may name the tree skill it needs and how deep (0-5, null = not needed). Absent on points read before 0074. */
  nodeId?: string | null;
  needK?: number | null;
  needU?: number | null;
  needD?: number | null;
}

export interface StringRow {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'unlocked';
  endNote: string | null;
  mergedInto: string | null;
  version: number;
  /** Point ids in order. */
  path: string[];
}

export interface LinkRow {
  id: string;
  from: string;
  to: string;
  why: string | null;
  createdBy: string;
  createdAt: string;
}

export interface EventRow {
  id: string;
  stringId: string | null;
  pointId: string | null;
  kind: string;
  at: string;
  by: string;
  reason: string | null;
  before: unknown;
  after: unknown;
}

export interface OrphanNote {
  courseCode: string;
  role: Role;
  statementHash: string;
  statement: string;
  reason: string;
  by: string;
  at: string;
}

export interface StringGraph {
  strings: StringRow[];
  points: Record<string, PointRow>;
  links: LinkRow[];
  events: EventRow[];
}

export type PointStatus =
  | { kind: 'intact'; now: Depth }
  | { kind: 'changed'; now: Depth | null; candidate: { statement: string; hash: string } }
  | { kind: 'unanchored'; why: 'skill gone' | 'course not found' | 'no capture' }
  | { kind: 'unchecked' };

/** A requires stop's check against the skill tree; null on stops that name no tree skill. */
export type NodeCheck =
  | { kind: 'not-checkable' }
  | { kind: 'checked'; nodeId: string; need: Depth; arriving: Depth; met: boolean; foundational: boolean };

export interface StopReading {
  pointId: string;
  courseCode: string;
  act: Act;
  role: Role;
  /** Attained now for develops, need for requires. */
  depth: Depth | null;
  status: PointStatus;
  /** Link into this stop. */
  why: string | null;
  nodeCheck: NodeCheck | null;
  slip: Array<'k' | 'u' | 'd'>;
  gap: Array<'k' | 'u' | 'd'>;
  reinforces: boolean;
  /** String ids merging into this string at this stop. */
  mergedIn: string[];
  sharedWith: Array<{ stringId: string; relation: 'joins' | 'branches' }>;
}

export interface StringReading {
  stops: StopReading[];
  reinforcement: number;
  end:
    | { kind: 'ends'; courseCode: string; act: Act; note: string | null }
    | { kind: 'merges'; into: string; courseCode: string };
}
