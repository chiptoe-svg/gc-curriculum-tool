// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const order: string[] = [];
vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn(async () => true) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn(async () => ({ code: 'GC 3460' })) }));
vi.mock('@/lib/db/course-materials-queries', () => ({
  listMaterialsByCourse: vi.fn(async () => [{
    id: 'src', blobUrl: null,
    extractedText: 'Watch https://www.youtube.com/watch?v=163KclzPM98 and read https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit and https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa98765/view',
  }]),
  insertMaterial: vi.fn(async (m: { fileName: string }) => { order.push(`insert ${m.fileName}`); return { id: `id:${m.fileName}` }; }),
  updateExtractionResult: vi.fn(async () => {}),
  updateIndexingStatus: vi.fn(async () => {}),
}));
vi.mock('@/lib/capture/ingest-queue', () => ({ enqueue: vi.fn(async (id: string) => { order.push(`enqueue ${id}`); }) }));
vi.mock('@/lib/capture/material-tier', () => ({
  tierLinkedMaterial: vi.fn(async (id: string, m: { text: string }) => { order.push(`tier ${id} ${m.text}`); return 'middle'; }),
}));
vi.mock('@/lib/google-docs/fetch-doc', () => ({ fetchGoogleFileText: vi.fn(async () => ({ status: 'ok', title: 'Brief', text: 'doc text' })) }));
vi.mock('@/lib/youtube/fetch-transcript', () => ({ fetchYouTubeTranscript: vi.fn(async () => ({ status: 'ok', text: 'video text', detectedLang: 'en' })) }));
vi.mock('@/lib/youtube/transcribe-audio', () => ({ transcribeYouTubeAudio: vi.fn(), fetchYouTubeTitle: vi.fn(async () => 'Colors POP') }));
vi.mock('@/lib/google-drive/fetch-pdf', () => ({ fetchDrivePdf: vi.fn(async () => ({ status: 'ok', title: 'Example', text: 'pdf text' })) }));

import { POST } from '../route';

beforeEach(() => { order.length = 0; });

// 2026-11-09 (owner): linked videos and documents go through the classifier,
// with their opening text, before they are queued, so the worker reads them at
// the right depth instead of treating a missing tier as a full read.
describe('scan-linked-docs tiering', () => {
  it('tiers every fetched item with its text before queuing it', async () => {
    const res = await POST(new Request('http://x/api/courses/GC%203460/scan-linked-docs?slug=s', { method: 'POST' }), { params: Promise.resolve({ code: 'GC%203460' }) });
    expect(res.status).toBe(200);
    for (const [name, text] of [['Google Doc: Brief', 'doc text'], ['YouTube: Colors POP', 'video text'], ['Drive PDF: Example', 'pdf text']]) {
      const tier = order.indexOf(`tier id:${name} ${text}`);
      const queued = order.indexOf(`enqueue id:${name}`);
      expect({ name, tier: tier >= 0, beforeQueue: tier < queued }).toEqual({ name, tier: true, beforeQueue: true });
    }
  });
});
