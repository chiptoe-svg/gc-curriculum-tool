// Shared types for the curriculum builder (spec docs/superpowers/specs/2026-11-14-curriculum-builder-design.md).
// Pure: imported by both the server loader and the client.

export type Act = 1 | 2 | 3;
export const ACTS: ReadonlyArray<{ act: Act; name: string; verb: string; span: string }> = [
  { act: 1, name: 'Foundations & Agency', verb: 'Learn the field', span: 'Years 1–2' },
  { act: 2, name: 'Integration & Mastery', verb: 'Integrate the field', span: 'To mid-junior year' },
  { act: 3, name: 'Specialty & Application', verb: 'Apply a focus', span: 'Junior spring – senior year' },
];

/** Depth on the 0–5 scale; null = no reading on that dimension (never zero). */
export interface Depth { k: number | null; u: number | null; d: number | null }
export interface CompetencyDepth extends Depth { competencyId: string }

/** Which reading of a course the plan stacks. */
export type Lens = 'discovered' | 'stated';
/** Where a contribution came from. */
export type Basis = 'discovered' | 'stated' | 'proposed';

export interface LibraryVersion {
  snapshotId: string;
  instructorName: string | null;
  createdAt: string;
  /** Empty when the capture has not been scored against the competency catalog yet. */
  depths: CompetencyDepth[];
  /** Competency statements from the captured profile, for the detail panel. */
  outcomes: Array<{ statement: string; k: number | null; u: number | null; d: number | null }>;
  /** The capture's own findings where stated objectives and evidence part ways. */
  disagreements: string[];
}

/** A what-if on a course (one with a finished page): the course as it would read if the change were made. */
export interface LibraryWhatIf {
  id: string;
  title: string;
  author: string;
  depths: CompetencyDepth[];
  /** Changed ratings the what-if could not tie to a competency; they are not in `depths`. */
  notComputed: string[];
}

export interface LibraryCourse {
  code: string;
  title: string;
  level: number;
  category: string;
  track: string;
  /** Catalog description (falls back to the course sheet's). */
  description: string;
  credits: string | null;
  /** Wiki course page, when one exists. */
  wiki: { slug: string; summary: string } | null;
  /** Stated learning objectives, as written on the course sheet. */
  objectives: string[];
  /** Depths read from the syllabus (what the course says it teaches). Empty = no reading. */
  stated: CompetencyDepth[];
  /** Captured versions, newest first, one per instructor. Empty = not captured. */
  versions: LibraryVersion[];
  whatIfs: LibraryWhatIf[];
}

export interface LibraryCompetency {
  id: string;
  name: string;
  foundational: boolean;
  /** The bundle card's stratum (technical, business, workflow_ai, foundational); null when it has no card. */
  stratum: string | null;
  /** Related competencies in the same stratum, nearest first, from the bundle-card embeddings. */
  neighbors: string[];
  know: string | null;
  understand: string | null;
  do: string;
}

export interface LibraryTarget {
  id: string;
  name: string;
  shortDefinition: string;
  /** Member competencies with the entry weight (null = pinned without a weight). */
  members: Array<{ competencyId: string; weight: number | null }>;
}

export interface LibraryPrereq {
  courseCode: string;
  prereqCode: string;
  kind: 'prereq' | 'concurrent_ok';
  anyOfGroup: number | null;
}

export interface Library {
  courses: LibraryCourse[];
  competencies: LibraryCompetency[];
  targets: LibraryTarget[];
  prereqs: LibraryPrereq[];
}

export interface ProposedCourse {
  id: string;            // 'new:<random>'
  /** 'new' = invented in this plan; 'catalog' = pulled from the Clemson catalog, not yet tracked by the tool. */
  source: 'new' | 'catalog';
  code: string;          // free label for a new course, the catalog code otherwise
  credits: string | null;
  title: string;
  description: string;
  objectives: string[];
  depths: CompetencyDepth[];
}

/** `branch` null = the trunk every student takes; otherwise the id of the branch the course belongs to. */
export interface Placement { ref: string; act: Act; branch: string | null }

/** An alternative pathway that splits from the trunk and builds toward some of the plan's career paths. */
export interface Branch { id: string; name: string; targetIds: string[] }

/** "from must come before to", by course ref. */
export interface Link { from: string; to: string }

/** Required depth at the end of Act 1, 2 and 3; null = nothing required at that checkpoint. */
export type ActLevels = [Depth | null, Depth | null, Depth | null];

/** A written objective for a checkpoint, checked through the competencies it is linked to. */
export interface WrittenObjective {
  id: string;
  act: Act;
  /** The career path it belongs to; null = the whole program. */
  targetId: string | null;
  text: string;
  competencyIds: string[];
}

/** Key in PlanGoal.levels for competencies added by hand rather than through a career path. */
export const PLAN_SCOPE = '_plan';

export interface PlanGoal {
  /** Career paths this plan builds toward. */
  targetIds: string[];
  /**
   * Required K/U/D per checkpoint: levels[careerTargetId | PLAN_SCOPE][competencyId].
   * A competency with no entry uses defaultLevels().
   */
  levels: Record<string, Record<string, ActLevels>>;
  /** Competencies added to / removed from the career paths' lists. */
  added: string[];
  removed: string[];
  written: WrittenObjective[];
}

export interface PlanState {
  goal: PlanGoal;
  lens: Lens;
  /** When a course has no reading under the chosen lens, use its other reading. */
  fill: boolean;
  /** Levels an unreinforced depth is assumed to lose per act (0 = fade not counted). An assumption, not a measurement. */
  fade: number;
  /**
   * Whether a closely related competency worked at integration depth slows this one's fade.
   * Off unless switched on: the transfer literature argues against assuming it (curriculum-map deep dive).
   */
  support: boolean;
  /** Array order is teaching order within an act. */
  placements: Placement[];
  branches: Branch[];
  /** Dependencies added in this plan, on top of the catalog prerequisites. */
  links: Link[];
  /** Catalog prerequisites this plan sets aside. */
  unlinked: Link[];
  proposed: ProposedCourse[];
  /** Chosen version per course code: a captured snapshot id, or `whatif:<id>` for a what-if; absent = newest capture. */
  versions: Record<string, string>;
}

export const EMPTY_PLAN: PlanState = {
  goal: { targetIds: [], levels: {}, added: [], removed: [], written: [] },
  lens: 'discovered',
  fill: true,
  fade: 1,
  support: false,
  placements: [],
  branches: [],
  links: [],
  unlinked: [],
  proposed: [],
  versions: {},
};
