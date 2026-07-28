import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcribeViaSparkAsr } from '@/lib/youtube/transcribe-audio';

let dir: string;
let audio: string;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  process.env.SPARK_ASR_URL = 'http://spark:5002/v1';
  dir = await mkdtemp(join(tmpdir(), 'asr-test-'));
  audio = join(dir, 'a.wav');
  await writeFile(audio, Buffer.from('RIFFxxxx'));
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(async () => {
  fetchSpy.mockRestore();
  await rm(dir, { recursive: true, force: true });
  delete process.env.SPARK_ASR_URL;
});

describe('transcribeViaSparkAsr', () => {
  it('POSTs the audio to /audio/transcriptions and returns trimmed text', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ text: '  hello world  ' }), { status: 200 }));
    const t = await transcribeViaSparkAsr(audio);
    expect(t).toBe('hello world');
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://spark:5002/v1/audio/transcriptions');
    expect(opts.method).toBe('POST');
  });

  it('throws on a non-OK response', async () => {
    fetchSpy.mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(transcribeViaSparkAsr(audio)).rejects.toThrow(/spark-asr 500/);
  });

  it('throws when SPARK_ASR_URL is unset', async () => {
    delete process.env.SPARK_ASR_URL;
    await expect(transcribeViaSparkAsr(audio)).rejects.toThrow(/SPARK_ASR_URL/);
  });
});
