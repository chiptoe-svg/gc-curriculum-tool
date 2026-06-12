/**
 * CRUD for faculty_flags (migration 0034). Thin; matching/drift logic lives
 * in lib/program/flags.ts. resolveFlag is the only mutation of an existing
 * row and refuses to touch an already-resolved flag (the dispute trail is
 * append-then-close, never rewrite).
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { facultyFlags, type FlaggedContext } from '@/lib/db/schema';

export type FacultyFlagRow = typeof facultyFlags.$inferSelect;

export interface CreateFlagInput {
  targetKind: 'coverage_cell' | 'profile_competency';
  courseCode: string;
  careerTargetId: string | null;
  subCompetencyId: string | null;
  competencyStatement: string | null;
  note: string;
  flaggedBy: string;
  flaggedContext: FlaggedContext | null;
}

export async function createFlag(input: CreateFlagInput): Promise<FacultyFlagRow> {
  const [row] = await db.insert(facultyFlags).values(input).returning();
  if (!row) throw new Error('flag insert returned no row');
  return row;
}

export async function listFlags(opts: { status?: 'open' | 'resolved' }): Promise<FacultyFlagRow[]> {
  const base = db.select().from(facultyFlags);
  const rows = opts.status
    ? await base.where(eq(facultyFlags.status, opts.status)).orderBy(desc(facultyFlags.createdAt))
    : await base.orderBy(desc(facultyFlags.createdAt));
  return rows;
}

export async function resolveFlag(
  id: string,
  opts: { resolvedBy: string; resolutionNote: string },
): Promise<FacultyFlagRow> {
  const [existing] = await db.select().from(facultyFlags).where(eq(facultyFlags.id, id)).limit(1);
  if (!existing) throw new Error(`flag not found: ${id}`);
  if (existing.status === 'resolved') throw new Error(`flag already resolved: ${id}`);
  const [row] = await db
    .update(facultyFlags)
    .set({ status: 'resolved', resolvedBy: opts.resolvedBy, resolutionNote: opts.resolutionNote, resolvedAt: new Date() })
    .where(eq(facultyFlags.id, id))
    .returning();
  if (!row) throw new Error('flag resolve returned no row');
  return row;
}
