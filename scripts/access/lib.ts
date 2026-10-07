import { normalizeCode, type Capability } from '@/lib/auth/authorize';
// checkCourses moved to lib/auth/grant-admin.ts (the /api/admin/access routes
// need it too); re-exported here so this script and its existing test keep
// importing it from '@/scripts/access/lib' unchanged.
export { checkCourses } from '@/lib/auth/grant-admin';
export interface GrantArgs { label: string; scope: string[]; can: Capability[]; expiresAt: Date | null }
const CAPS: Capability[] = ['capture', 'create', 'admin'];

export function parseGrantArgs(argv: string[], now = new Date()): GrantArgs {
  const [label = '', ...rest] = argv;
  if (!label.trim()) throw new Error('label is required: access:grant "<label>" --courses … --can … (--days N | --no-expiry)');
  const opt = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const rawCourses = opt('--courses'); const rawCan = opt('--can'); const days = opt('--days'); const noExpiry = rest.includes('--no-expiry');
  if (!rawCourses) throw new Error('--courses is required ("GC 3730,GC 3740" or "*")');
  const scope = rawCourses === '*' ? ['*'] : rawCourses.split(',').map(normalizeCode).filter(Boolean);
  const can = (rawCan ?? '').split(',').map(s => s.trim()).filter(Boolean) as Capability[];
  if (can.length === 0) throw new Error('--can is required (capture[,create,admin])');
  for (const c of can) if (!CAPS.includes(c)) throw new Error(`unknown capability "${c}" (capture, create, admin)`);
  if (can.includes('admin') && !scope.includes('*')) throw new Error("admin requires --courses '*'");
  if (!days && !noExpiry) throw new Error('--days or --no-expiry is required');
  const expiresAt = noExpiry ? null : new Date(now.getTime() + Number(days) * 86400_000);
  if (!noExpiry && !(Number(days) > 0)) throw new Error('--days must be a positive number');
  return { label: label.trim(), scope, can, expiresAt };
}
