import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Loads interview skills: Agent Skills `SKILL.md` files under `lib/ai/skills/interview/<name>/`.
 * The app injects the active stage's skill; the model may load the situational ones via `load_skill`.
 */
const SKILL_DIR = join(process.cwd(), 'lib/ai/skills/interview');

/** Skills the model may load itself through the `load_skill` tool. */
export const SITUATIONAL_SKILLS = ['materials-vs-testimony', 'critique-or-oral-assessment', 'first-time-instructor'] as const;

export type Skill = { name: string; description: string; body: string };

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BLOOM_RE = /<!-- bloom -->([\s\S]*?)<!-- \/bloom -->/g;

function field(fm: string, key: string): string | null {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.+)$`, 'm'));
  if (!m || !m[1]) return null;
  const v = m[1].trim();
  // Accept a single- or double-quoted scalar.
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

function parse(name: string): { name: string; description: string; raw: string } {
  if (name.length > 64 || !NAME_RE.test(name)) throw new Error(`Invalid skill name: ${JSON.stringify(name)}`);
  const text = readFileSync(join(SKILL_DIR, name, 'SKILL.md'), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`Skill ${name}: missing frontmatter`);
  const fm = m[1] ?? '';
  const fmName = field(fm, 'name');
  const description = field(fm, 'description');
  if (fmName !== name) throw new Error(`Skill ${name}: frontmatter name ${JSON.stringify(fmName)} must match its directory`);
  if (!description || description.length > 1024) throw new Error(`Skill ${name}: description must be 1-1024 characters`);
  return { name, description, raw: m[2] ?? '' };
}

const cache = new Map<string, Skill>();

/**
 * Read and validate a skill. With `bloom: false` the `<!-- bloom -->` blocks are removed;
 * otherwise only their markers are. Memoized per name and option.
 */
export function loadSkill(name: string, opts?: { bloom?: boolean }): Skill {
  const bloom = opts?.bloom !== false;
  const key = `${name}\u0000${bloom}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = parse(name);
  const body = p.raw
    .replace(BLOOM_RE, (_all, inner: string) => (bloom ? inner.trim() : ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const skill: Skill = { name: p.name, description: p.description, body };
  cache.set(key, skill);
  return skill;
}
