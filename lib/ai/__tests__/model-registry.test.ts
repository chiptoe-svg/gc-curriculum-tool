/** Model ids live only in lib/ai/models.ts; every call picks its model through function settings. */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AI_FUNCTION_IDS, DEFAULT_ROLES } from '@/lib/ai/function-settings';

const ROOT = join(__dirname, '../../..');
const REGISTRY = 'lib/ai/models.ts';
// Historical measurements keyed by the model that was measured; not a model choice.
const ALLOWED = new Set([REGISTRY, 'lib/program/reliability-summary.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

// Code only: comment lines may mention model names as examples.
const codeOnly = (text: string) => text.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const files = ['lib', 'app'].flatMap(d => sourceFiles(join(ROOT, d))).map(p => ({ rel: relative(ROOT, p), text: codeOnly(readFileSync(p, 'utf8')) }));

describe('model registry', () => {
  it('no OpenAI model id is written outside lib/ai/models.ts', () => {
    const offenders = files
      .filter(f => !ALLOWED.has(f.rel))
      .flatMap(f => [...f.text.matchAll(/['"`](gpt-\d[\w.-]*)['"`]/g)].map(m => `${f.rel}: ${m[1]}`));
    expect(offenders).toEqual([]);
  });

  it('OPENAI_MODEL no longer chooses a model', () => {
    expect(files.filter(f => f.text.includes('process.env.OPENAI_MODEL')).map(f => f.rel)).toEqual([]);
  });

  it('KUD chat is a named function in the Converse role', () => {
    expect(AI_FUNCTION_IDS).toContain('kud-chat');
    expect(DEFAULT_ROLES['kud-chat']).toBe('converse');
  });
});
