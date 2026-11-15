/**
 * Is the working draft exactly the version that was last approved?
 *
 * The review page always opens on the working draft. When that draft is the
 * approved snapshot, unchanged, there is nothing to review: the page should
 * say so instead of asking the instructor to confirm cards and approve again
 * (which records an identical snapshot). Pure: no DB.
 */

/** JSON with object keys sorted, so two equal values always give the same text. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The draft-only revision change list is stripped before a snapshot, so it never counts as a difference. */
const withoutRevision = (profile: unknown): unknown => {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return profile;
  const rest = { ...(profile as Record<string, unknown>) };
  delete rest.revision;
  return rest;
};

/**
 * The date the draft's content was approved (ISO), or null when the draft is
 * not confirmed, there is no snapshot, the draft carries an open revision, or
 * the draft differs from the latest snapshot in any way.
 */
export function approvedOn(
  draft: { profile: unknown; reviewerStatus: string; reviewerNote?: string | null } | null | undefined,
  snapshot: { profile: unknown; createdAt: Date | string; reviewerNote?: string | null } | null | undefined,
): string | null {
  if (!draft || !snapshot || draft.reviewerStatus !== 'confirmed') return null;
  const revision = (draft.profile as { revision?: unknown } | null)?.revision;
  if (revision != null) return null;
  if ((draft.reviewerNote ?? '').trim() !== (snapshot.reviewerNote ?? '').trim()) return null;
  if (stable(withoutRevision(draft.profile)) !== stable(withoutRevision(snapshot.profile))) return null;
  return new Date(snapshot.createdAt).toISOString();
}
