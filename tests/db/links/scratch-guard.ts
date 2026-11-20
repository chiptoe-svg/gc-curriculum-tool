/** Links-drive-coverage DB tests run ONLY against gc_curriculum_links_scratch (a restore of a live backup). */
export const LINKS_SCRATCH_DB = 'gc_curriculum_links_scratch';
export function isLinksScratchDb(): boolean {
  try { return new URL(process.env.DATABASE_URL ?? '').pathname === `/${LINKS_SCRATCH_DB}`; } catch { return false; }
}
