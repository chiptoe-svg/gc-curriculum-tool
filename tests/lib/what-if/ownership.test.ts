import { describe, it, expect } from 'vitest';
import type { Grant } from '@/lib/auth/authorize';
import { ownerOf, canManageWhatIf, canReadWhatIf } from '@/lib/what-if/ownership';

const scoped: Grant = { id: 'g1', label: 'Danita', scope: ['GC 3730'], can: ['capture'] };
const admin: Grant = { id: 'g3', label: 'owner', scope: ['*'], can: ['capture', 'create', 'admin'] };
const dept = (fp: string): Grant => ({ id: `builtin:faculty:${fp}`, label: 'Department login', scope: ['*'], can: ['capture', 'create'] });

describe('ownership', () => {
  it('department logins own by role, without the credential fingerprint', () => {
    expect(ownerOf(dept('aaaaaaaaaaaaaaaa'))).toEqual({ ownerGrantId: 'builtin:faculty', ownerKind: 'department' });
  });
  it('personal grants own by their full id', () => {
    expect(ownerOf(scoped)).toEqual({ ownerGrantId: scoped.id, ownerKind: 'personal' });
  });
  const w = { ...ownerOf(dept('aaaaaaaaaaaaaaaa')) };
  it('manage: same role survives a password change, others cannot, admin can', () => {
    expect(canManageWhatIf(dept('bbbbbbbbbbbbbbbb'), w)).toBe(true);
    expect(canManageWhatIf(scoped, w)).toBe(false);
    expect(canManageWhatIf(admin, w)).toBe(true);
    expect(canManageWhatIf({ ...scoped, id: 'other' }, { ownerGrantId: scoped.id, ownerKind: 'personal' })).toBe(false);
    expect(canManageWhatIf(scoped, { ownerGrantId: scoped.id, ownerKind: 'personal' })).toBe(true);
  });
  it('read: a page makes it readable, otherwise only managers', () => {
    expect(canReadWhatIf(scoped, { ...w, pageCreatedAt: new Date() })).toBe(true);
    expect(canReadWhatIf(scoped, { ...w, pageCreatedAt: null })).toBe(false);
    expect(canReadWhatIf(admin, { ...w, pageCreatedAt: null })).toBe(true);
  });
});
