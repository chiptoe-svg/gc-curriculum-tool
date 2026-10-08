/**
 * The credential-related env values every sign-in path reads, in one place
 * (spec 2026-10-08, retire the shared department password).
 *
 * DEPARTMENT_LOGIN (`on` | `off`, default `on`) is the one switch that
 * retires the shared department password: `off` (case-insensitive, trimmed,
 * quotes stripped; also false/0/no/disabled) disables it. Unset or `on` keeps it; any other value also keeps it (the
 * default stays as today until the owner flips it) but logs a warning once
 * per process so a typo doesn't go unnoticed.
 */
let warned = false;

// Near-miss spellings of "off" also turn it off (adversarial review, 2026-10-08):
// the switch must not fail toward the password the owner meant to retire.
const OFF_VALUES = new Set(['off', 'false', '0', 'no', 'disabled']);

export function departmentLoginEnabled(raw: string | undefined = process.env.DEPARTMENT_LOGIN): boolean {
  const v = (raw ?? '').trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
  if (OFF_VALUES.has(v)) return false;
  if (v !== '' && v !== 'on' && !warned) {
    warned = true;
    console.warn(`[auth] DEPARTMENT_LOGIN has an unrecognized value; expected "on" or "off". Treating it as "on".`);
  }
  return true;
}

/** Test hook: lets a test observe the once-per-process warning again. */
export function resetDepartmentLoginWarning(): void { warned = false; }

export const DEFAULT_SIGNIN_CONTACT = 'Chip Tonkin';

export interface AuthEnv {
  sessionSecret?: string;
  faculty?: string;
  creator?: string;
  departmentLogin: boolean;
}

/** Current credential env, read fresh each call (tests stub process.env). */
export function authEnv(): AuthEnv {
  return {
    sessionSecret: process.env.SESSION_SECRET?.trim() || undefined,
    faculty: process.env.FACULTY_BASIC_AUTH,
    creator: process.env.CREATE_ONLY_AUTH,
    departmentLogin: departmentLoginEnabled(),
  };
}
