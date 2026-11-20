import type { Depth } from '@/lib/builder/types';

export interface TreeNode {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  competencyId: string | null;
  foundational: boolean;
  weight: number;
  weightSource: 'default' | 'faculty' | 'onet' | 'employer';
  mergedInto: string | null;
  retired: boolean;
}

export interface TreeLeaf {
  courseCode: string;
  skillRef: string;
  nodeId: string;
  statement: string;
  share: number | null;
  source: 'embedding' | 'ai' | 'scoring' | 'faculty';
  status: 'proposed' | 'confirmed' | 'rejected';
}

export interface HandDepth {
  nodeId: string;
  courseCode: string;
  instructor: string;
  k: number | null;
  u: number | null;
  d: number | null;
  method: 'faculty' | 'ai';
  leavesSignature: string;
  setBy: string;
}

export interface Tree {
  nodes: TreeNode[];
  leaves: TreeLeaf[];
  depths: HandDepth[];
}

/** One course version's skills: skillRef -> its K/U/D in that capture. */
export interface VersionSkills {
  courseCode: string;
  instructor: string;
  skills: Map<string, Depth>;
}

export interface NodeReading extends Depth {
  nodeId: string;
  byHand: boolean;
  computed: Depth;
  needsReview: boolean;
  /** Child nodes, in name order. */
  children: NodeReading[];
  /** Leaves placed here that count. */
  direct: Array<{ skillRef: string; statement: string; courseCode: string; depth: Depth; weight: number }>;
  /** The implicit "Skills placed here" child's weight; null when no direct leaves exist in the tree. */
  directWeight: number | null;
}
