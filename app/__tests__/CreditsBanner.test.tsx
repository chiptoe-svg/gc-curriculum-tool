import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CreditsBanner } from '../CreditsBanner';
import { CREDITS_EXHAUSTED_MESSAGE, creditsContact } from '@/lib/ai/credit-status';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'banner-'));
  process.env.AI_CREDITS_STATUS_FILE = path.join(dir, 's.json');
});
afterEach(async () => { delete process.env.AI_CREDITS_STATUS_FILE; await rm(dir, { recursive: true, force: true }); });

const write = (status: string) => writeFile(process.env.AI_CREDITS_STATUS_FILE!, JSON.stringify({ status, since: 'a', checkedAt: 'a', source: 'probe', detail: '' }));

describe('CreditsBanner', () => {
  it('shows the message when exhausted', async () => {
    await write('exhausted');
    render(await CreditsBanner());
    expect(screen.getByText(CREDITS_EXHAUSTED_MESSAGE(creditsContact()))).toBeInTheDocument();
  });
  it('renders nothing when ok, unknown, or missing', async () => {
    await write('ok');
    expect((await CreditsBanner())).toBeNull();
    await write('unknown');
    expect((await CreditsBanner())).toBeNull();
    await rm(process.env.AI_CREDITS_STATUS_FILE!);
    expect((await CreditsBanner())).toBeNull();
  });
});
