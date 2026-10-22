import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HandoffProvider, WikiHandoffPending } from '@/lib/ai/wiki/handoff-provider';

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'handoff-')); });
const req = (userMessage: string) => ({
  systemPrompt: 'SYS', userMessage, schemaName: 'wiki_update', jsonSchema: {},
  validate: (raw: unknown) => { const o = raw as { pages?: unknown }; if (!Array.isArray(o.pages)) throw new Error('pages missing'); return raw as { pages: unknown[] }; },
});

describe('HandoffProvider', () => {
  it('writes a request and throws WikiHandoffPending when no reply exists', async () => {
    const p = new HandoffProvider(dir);
    await expect(p.complete(req('M1'))).rejects.toBeInstanceOf(WikiHandoffPending);
    const files = readdirSync(path.join(dir, 'requests'));
    expect(files).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(dir, 'requests', files[0]!), 'utf8'))).toMatchObject({ systemPrompt: 'SYS', userMessage: 'M1', schemaName: 'wiki_update' });
  });

  it('returns the validated reply for the same message on the next run', async () => {
    const p = new HandoffProvider(dir);
    await p.complete(req('M1')).catch(() => {});
    const key = readdirSync(path.join(dir, 'requests'))[0]!.replace('.json', '');
    mkdirSync(path.join(dir, 'responses'), { recursive: true });
    writeFileSync(path.join(dir, 'responses', `${key}.json`), JSON.stringify({ pages: [{ path: 'a.md', content: 'x' }] }));
    const r = await new HandoffProvider(dir).complete(req('M1'));
    expect(r.data).toEqual({ pages: [{ path: 'a.md', content: 'x' }] });
  });

  it('a different message gets a different key; an invalid reply throws the validation error', async () => {
    const p = new HandoffProvider(dir);
    await p.complete(req('M1')).catch(() => {});
    await p.complete(req('M2')).catch(() => {});
    const keys = readdirSync(path.join(dir, 'requests'));
    expect(keys).toHaveLength(2);
    mkdirSync(path.join(dir, 'responses'), { recursive: true });
    writeFileSync(path.join(dir, 'responses', keys[0]!), JSON.stringify({ nope: 1 }));
    const msg = JSON.parse(readFileSync(path.join(dir, 'requests', keys[0]!), 'utf8')).userMessage as string;
    await expect(p.complete(req(msg))).rejects.toThrow(/pages missing/);
  });
});

describe('wikiProvider', () => {
  it('uses the handoff provider when WIKI_HANDOFF_DIR is set, else the configured provider', async () => {
    const { wikiProvider } = await import('@/lib/ai/wiki/handoff-provider');
    process.env.WIKI_HANDOFF_DIR = dir;
    try {
      expect(await wikiProvider(async () => { throw new Error('should not be called'); })).toBeInstanceOf(HandoffProvider);
    } finally {
      delete process.env.WIKI_HANDOFF_DIR;
    }
    const configured = { complete: async () => ({ data: {} }) };
    expect(await wikiProvider(async () => configured as never)).toBe(configured);
  });
});
