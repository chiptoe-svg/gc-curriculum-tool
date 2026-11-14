import type { Grant } from '@/lib/auth/authorize';
import type { WhatIfRow } from '@/lib/db/what-if-queries';
import type { OwnerKind } from './types';

/** Who owns what this grant creates. A department login (`builtin:<role>:<fingerprint>`)
 * owns by role only, so a password change does not orphan its what-ifs; anything else
 * owns by its full grant id. */
export function ownerOf(grant: Grant): { ownerGrantId: string; ownerKind: OwnerKind } {
  if (grant.id.startsWith('builtin:')) {
    return { ownerGrantId: grant.id.split(':').slice(0, 2).join(':'), ownerKind: 'department' };
  }
  return { ownerGrantId: grant.id, ownerKind: 'personal' };
}

// Same admin test authorize() uses for its 'admin' kind.
const isAdmin = (g: Grant) => g.scope.includes('*') && g.can.includes('admin');

export function canManageWhatIf(grant: Grant, w: Pick<WhatIfRow, 'ownerGrantId' | 'ownerKind'>): boolean {
  if (isAdmin(grant)) return true;
  const me = ownerOf(grant);
  return me.ownerKind === w.ownerKind && me.ownerGrantId === w.ownerGrantId;
}

/** A what-if is readable by anyone once it has a page; before that, only by those who manage it. */
export function canReadWhatIf(grant: Grant, w: Pick<WhatIfRow, 'ownerGrantId' | 'ownerKind' | 'pageCreatedAt'>): boolean {
  return w.pageCreatedAt !== null || canManageWhatIf(grant, w);
}
