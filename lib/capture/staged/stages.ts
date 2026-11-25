import type { EvidenceMap } from './evidence-map';

export type StageId = 1 | 2 | 3 | 4 | 5 | 6;

export const PLANNED_TOTAL = 16;
export const HARD_CAP = 20;
export const MAX_FOLLOW_UPS = 5;

export type StageDef = {
  id: StageId;
  title: string;
  skill: string;
  planned: number;
  cap: number;
  /** Slot ids for this stage, given the map (may be null) and the recorded anchors (at most 2). */
  slots: (map: EvidenceMap | null, anchors: string[]) => string[];
};

export const STAGES: ReadonlyArray<StageDef> = [
  { id: 1, title: 'The course in your words', skill: 'stage-1-course', planned: 2, cap: 3, slots: () => ['outcomes', 'anchors'] },
  {
    id: 2, title: 'Evidence walk', skill: 'stage-2-evidence', planned: 5, cap: 7,
    slots: (_m, anchors) => [...anchors.slice(0, 2).map((a) => `graded_on:${a}`), 'conditions', 'reasoning_evidence', 'tests'],
  },
  { id: 3, title: 'When it goes wrong, and the leap', skill: 'stage-3-wrong-and-leap', planned: 3, cap: 4, slots: () => ['revision', 'transfer', 'threshold'] },
  { id: 4, title: 'What students walk in with', skill: 'stage-4-incoming', planned: 2, cap: 3, slots: () => ['incoming', 'reteach'] },
  { id: 5, title: 'Habits and communication', skill: 'stage-5-habits', planned: 1, cap: 2, slots: () => ['habits'] },
  {
    id: 6, title: 'Objectives and close', skill: 'stage-6-objectives', planned: 2, cap: 3,
    slots: (map) => (map?.objectives.some((o) => o.status === 'not_found') ? ['objectives', 'recap'] : ['recap']),
  },
];
