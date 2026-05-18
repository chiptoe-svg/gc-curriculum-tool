import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PROMPT_DIR = join(process.cwd(), 'lib/ai/prompts');

type PromptName =
  | 'draft-outcomes'
  | 'score-coverage'
  | 'suggest-prerequisites'
  | 'analyze-prerequisite-gaps';

interface ParsedPrompt {
  frontmatter: Record<string, unknown>;
  body: string;
  includes: string[];
}

function parseFrontmatter(raw: string): ParsedPrompt {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw, includes: [] };
  }
  const fmRaw = match[1] ?? '';
  const body = match[2] ?? '';
  // Tiny YAML reader: only handles the fields we use (name, manning_skills, includes).
  const includes: string[] = [];
  const includesMatch = fmRaw.match(/includes:\n((?:\s*-\s+\S.*\n?)+)/);
  if (includesMatch && includesMatch[1]) {
    for (const line of includesMatch[1].split('\n')) {
      const m = line.match(/^\s*-\s+(.+)\s*$/);
      if (m && m[1]) includes.push(m[1].trim());
    }
  }
  return { frontmatter: {}, body, includes };
}

async function readPrompt(relPath: string): Promise<string> {
  return readFile(join(PROMPT_DIR, relPath), 'utf-8');
}

export async function loadPrompt(name: PromptName): Promise<string> {
  const main = await readPrompt(`${name}.md`);
  const parsed = parseFrontmatter(main);
  const includes = await Promise.all(parsed.includes.map(p => readPrompt(p)));
  const parts: string[] = [];
  for (const inc of includes) {
    parts.push(parseFrontmatter(inc).body.trim());
  }
  parts.push(parsed.body.trim());
  return parts.join('\n\n---\n\n');
}
