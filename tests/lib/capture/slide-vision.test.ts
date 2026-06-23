/**
 * Tests for lib/capture/slide-vision.ts
 *
 * All HTTP I/O is mocked via vi.spyOn(globalThis, 'fetch') — the same
 * pattern used in tests/ai/embeddings.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { describeSlide } from '@/lib/capture/slide-vision';
import type { SlideNote } from '@/lib/capture/slide-vision';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(note: SlideNote) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(note),
          },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const SAMPLE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes

// ---------------------------------------------------------------------------
// Setup & teardown
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  // Default env — tests can override per-case
  process.env.LOCAL_BASE_URL = 'http://localhost:8000/v1';
  process.env.LOCAL_API_KEY = 'test-omlx-key';
  delete process.env.SLIDE_VISION_MODEL;
});

afterEach(() => {
  fetchSpy.mockRestore();
  delete process.env.LOCAL_BASE_URL;
  delete process.env.LOCAL_API_KEY;
  delete process.env.SLIDE_VISION_MODEL;
});

// ---------------------------------------------------------------------------
// Happy path — well-formed JSON response
// ---------------------------------------------------------------------------

describe('describeSlide — well-formed response', () => {
  it('parses topic, teaches, keyVisual, contentLevel from a substantive slide', async () => {
    const expected: SlideNote = {
      topic: 'Color Theory',
      teaches: 'How warm/cool contrast creates visual depth',
      keyVisual: 'Color wheel with annotated warm/cool zones',
      contentLevel: 'substantive',
    };

    fetchSpy.mockResolvedValueOnce(makeOkResponse(expected));

    const result = await describeSlide(SAMPLE_PNG);

    expect(result.topic).toBe('Color Theory');
    expect(result.teaches).toBe('How warm/cool contrast creates visual depth');
    expect(result.keyVisual).toBe('Color wheel with annotated warm/cool zones');
    expect(result.contentLevel).toBe('substantive');
  });

  it('parses contentLevel:"low" for a title slide', async () => {
    const titleSlide: SlideNote = {
      topic: '',
      teaches: '',
      keyVisual: 'Title text only',
      contentLevel: 'low',
    };

    fetchSpy.mockResolvedValueOnce(makeOkResponse(titleSlide));

    const result = await describeSlide(SAMPLE_PNG);
    expect(result.contentLevel).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Request shape — image_url data-URI + Authorization header
// ---------------------------------------------------------------------------

describe('describeSlide — request shape', () => {
  it('sends an image_url part with a data:image/png;base64, URI', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse({ topic: 'x', teaches: 'x', keyVisual: 'x', contentLevel: 'substantive' }),
    );

    await describeSlide(SAMPLE_PNG);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [_url, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);

    // Find the image_url part inside messages[0].content
    const contentParts: Array<{ type: string; image_url?: { url: string } }> =
      body.messages[0].content;
    const imagePart = contentParts.find((p) => p.type === 'image_url');

    expect(imagePart).toBeDefined();
    const dataUri = imagePart!.image_url!.url;
    expect(dataUri).toMatch(/^data:image\/png;base64,/);

    // The base64 payload must match the input buffer
    const expectedBase64 = SAMPLE_PNG.toString('base64');
    expect(dataUri).toBe(`data:image/png;base64,${expectedBase64}`);
  });

  it('includes Authorization: Bearer <LOCAL_API_KEY> header', async () => {
    process.env.LOCAL_API_KEY = 'secret-key-xyz';
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse({ topic: 'x', teaches: 'x', keyVisual: 'x', contentLevel: 'substantive' }),
    );

    await describeSlide(SAMPLE_PNG);

    const [_url, init] = fetchSpy.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-key-xyz');
  });

  it('POSTs to LOCAL_BASE_URL/chat/completions', async () => {
    process.env.LOCAL_BASE_URL = 'http://localhost:9999/v1';
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse({ topic: 'x', teaches: 'x', keyVisual: 'x', contentLevel: 'substantive' }),
    );

    await describeSlide(SAMPLE_PNG);

    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:9999/v1/chat/completions');
  });

  it('uses SLIDE_VISION_MODEL env override when set', async () => {
    process.env.SLIDE_VISION_MODEL = 'my-custom-vision-model';
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse({ topic: 'x', teaches: 'x', keyVisual: 'x', contentLevel: 'substantive' }),
    );

    await describeSlide(SAMPLE_PNG);

    const [_url, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('my-custom-vision-model');
  });

  it('falls back to gemma-4-12B-it-qat-4bit when SLIDE_VISION_MODEL is unset', async () => {
    // E4B-8bit is a broken-for-vision MLX conversion (silently drops the image);
    // 12B-qat-4bit ingests images. See lib/capture/slide-vision.ts. (2026-06-23)
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse({ topic: 'x', teaches: 'x', keyVisual: 'x', contentLevel: 'substantive' }),
    );

    await describeSlide(SAMPLE_PNG);

    const [_url, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('gemma-4-12B-it-qat-4bit');
  });
});

// ---------------------------------------------------------------------------
// Error handling — non-OK status → safe default, no throw
// ---------------------------------------------------------------------------

describe('describeSlide — non-OK HTTP status', () => {
  it('returns safe default on 500 without throwing', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const result = await describeSlide(SAMPLE_PNG);

    expect(result).toEqual<SlideNote>({
      topic: '',
      teaches: '',
      keyVisual: '',
      contentLevel: 'low',
    });
  });

  it('returns safe default on 503 without throwing', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Service Unavailable', { status: 503 }),
    );

    const result = await describeSlide(SAMPLE_PNG);
    expect(result.contentLevel).toBe('low');
    expect(result.topic).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Error handling — non-JSON content → safe default, no throw
// ---------------------------------------------------------------------------

describe('describeSlide — non-JSON response body', () => {
  it('returns safe default when body is plain text', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('not json at all', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    const result = await describeSlide(SAMPLE_PNG);

    expect(result).toEqual<SlideNote>({
      topic: '',
      teaches: '',
      keyVisual: '',
      contentLevel: 'low',
    });
  });

  it('returns safe default when choices[0].message.content is invalid JSON', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{ broken json' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await describeSlide(SAMPLE_PNG);
    expect(result.contentLevel).toBe('low');
    expect(result.topic).toBe('');
  });

  it('returns safe default when fetch itself rejects (network error)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await describeSlide(SAMPLE_PNG);
    expect(result).toEqual<SlideNote>({
      topic: '',
      teaches: '',
      keyVisual: '',
      contentLevel: 'low',
    });
  });
});

// ---------------------------------------------------------------------------
// Field coercion — contentLevel coercion
// ---------------------------------------------------------------------------

describe('describeSlide — field coercion', () => {
  it('coerces unknown contentLevel values to "low"', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  topic: 'Density',
                  teaches: 'Mass vs volume',
                  keyVisual: 'Diagram',
                  contentLevel: 'high',  // not a valid enum value
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await describeSlide(SAMPLE_PNG);
    expect(result.contentLevel).toBe('low');
    expect(result.topic).toBe('Density');
  });

  it('coerces missing string fields to empty string', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  // topic and teaches are missing
                  keyVisual: 'Some visual',
                  contentLevel: 'substantive',
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await describeSlide(SAMPLE_PNG);
    expect(result.topic).toBe('');
    expect(result.teaches).toBe('');
    expect(result.keyVisual).toBe('Some visual');
    expect(result.contentLevel).toBe('substantive');
  });
});
