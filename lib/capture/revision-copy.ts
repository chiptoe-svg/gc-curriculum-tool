/**
 * Revision modes and their owner-approved copy (2026-11-08; spec
 * docs/superpowers/specs/2026-11-08-course-revision-modes-labels-design.md).
 * Client-safe: no server imports.
 */
export type RevisionMode = 'targeted' | 'recheck' | 'fresh';

export const REVISION_MODES: readonly RevisionMode[] = ['targeted', 'recheck', 'fresh'];

export function isRevisionMode(v: unknown): v is RevisionMode {
  return typeof v === 'string' && (REVISION_MODES as readonly string[]).includes(v);
}

export const REVISION_HEADING = "What's changed in this course since it was approved?";

export const REVISION_MODE_COPY: Record<RevisionMode, { label: string; description: string }> = {
  targeted: {
    label: 'A few specific things changed',
    description:
      "Tell us what changed. Every rating is checked again; any rating that moves without new evidence is set back to the approved version for you. You'll see each change and approve it before it counts.",
  },
  recheck: {
    label: 'Re-check the whole course',
    description:
      "The approved version is the starting point, but every rating is checked again against your current materials and this conversation. You'll see what moved before approving.",
  },
  fresh: {
    label: 'Start over',
    description:
      'Build a new profile from your current materials and the catalog, as if for the first time. The approved version stays in place until you approve the new one.',
  },
};
