/** Audit Area 7 (productive-failure / transfer) condition rating. */
export type PfCond = 'present' | 'partial' | 'absent';

/** Per-course Area-7 conditions block as carried on the captured profile. */
export interface Area7Block {
  generate_then_consolidate?: PfCond;
  open_ended_problems?: PfCond;
  revision_cycles?: PfCond;
  structured_post_mortem?: PfCond;
  abstraction_bridging?: PfCond;
  max_supporting_depth?: number | null;
}
