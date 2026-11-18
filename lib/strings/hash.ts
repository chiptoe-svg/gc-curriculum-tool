import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';

/** The hash a skill statement is matched by, wherever strings compare wording. */
export const hashOf = (statement: string): string => textHash(normalizeStatement(statement));
