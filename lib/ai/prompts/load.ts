import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PROMPT_DIR = join(process.cwd(), 'lib/ai/prompts');

type PromptName =
  | 'draft-outcomes'
  | 'score-coverage'
  | 'suggest-prerequisites'
  | 'analyze-prerequisite-gaps'
  | 'evaluate-scaffolding'
  | 'synthesize-target'
  | 'analyze-material'
  | 'synthesize-course-profile'
  // Course-centric prereq pipeline
  | 'draft-course-outcomes'
  | 'extract-course-prereqs'
  | 'score-prior-coverage'
  | 'analyze-course-gaps'
  | 'evaluate-course-scaffolding'
  | 'extract-course-kud'
  | 'kud-chat'
  | 'capture-chat'
  | 'capture-scores'
  | 'explore-draft-target'
  | 'explore-compare'
  | 'explore-what-if'
  | 'explore-local-delta'
  | 'program-score-coverage'
  | 'parse-profile-fields'
  | 'decompose-prereq-gap'
  | 'material-digest'
  | 'chunk-contextualize'
  | 'ingestion-checkin'
  | 'capture-chat-agent'
  | 'capture-synthesis'
  | 'capture-stress-test'
  | 'jd-extract'
  | 'position-rated-items'
  | 'position-interview-agent'
  | 'position-synthesis'
  | 'wiki-update'
  | 'curriculum-chat'
  | 'prereq-edge-seed'
  | 'intended-skills-extract'
  | 'reconcile-feedback'
  | 'material-classify'
  | 'explore-agent';

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

async function buildPrompt(name: PromptName): Promise<string> {
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

// Prompt files are static for a process lifetime, so the assembled text is
// memoized. Beyond saving redundant disk reads, this is what lets the analyze
// routes warm the cache up front: once cached, a helper's internal
// `await loadPrompt(...)` resolves in a single uniform microtask hop, so a
// batch of helpers run via Promise.all still invoke the AI provider in stable
// array order.
const promptCache = new Map<PromptName, Promise<string>>();

export function loadPrompt(name: PromptName): Promise<string> {
  let cached = promptCache.get(name);
  if (!cached) {
    cached = buildPrompt(name).catch((err: unknown) => {
      promptCache.delete(name);
      throw err;
    });
    promptCache.set(name, cached);
  }
  return cached;
}
