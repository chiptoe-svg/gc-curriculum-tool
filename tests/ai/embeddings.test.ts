import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  embedBatch,
  embedText,
  cosineSimilarity,
  InMemoryVectorStore,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIM,
} from '@/lib/ai/embeddings';

const TEST_OPTS = {
  baseURL: 'https://llm.example.test/v1',
  apiKey: 'test-key',
};

function fakeEmbeddingsResponse(vectors: number[][]) {
  return {
    object: 'list',
    data: vectors.map((embedding, index) => ({ object: 'embedding', embedding, index })),
    model: DEFAULT_EMBEDDING_MODEL,
    usage: { prompt_tokens: 8, total_tokens: 8 },
  };
}

describe('embeddings', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('posts to /embeddings with bearer auth and returns one vector per input', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(fakeEmbeddingsResponse([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const out = await embedBatch(['hello', 'world'], TEST_OPTS);

    expect(out).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://llm.example.test/v1/embeddings');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: DEFAULT_EMBEDDING_MODEL, input: ['hello', 'world'] });
  });

  it('embedText returns a single vector', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(fakeEmbeddingsResponse([[1, 0, 0]])), { status: 200 }),
    );
    const v = await embedText('hello', TEST_OPTS);
    expect(v).toEqual([1, 0, 0]);
  });

  it('strips trailing slash from baseURL so /embeddings is not doubled', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(fakeEmbeddingsResponse([[0]])), { status: 200 }),
    );
    await embedBatch(['x'], { ...TEST_OPTS, baseURL: 'https://llm.example.test/v1/' });
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://llm.example.test/v1/embeddings');
  });

  it('returns [] for an empty input list without calling the API', async () => {
    const out = await embedBatch([], TEST_OPTS);
    expect(out).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('preserves order even when the API returns rows out of order', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { object: 'embedding', embedding: [0.4, 0.5, 0.6], index: 1 },
            { object: 'embedding', embedding: [0.1, 0.2, 0.3], index: 0 },
          ],
          model: DEFAULT_EMBEDDING_MODEL,
          usage: { prompt_tokens: 4, total_tokens: 4 },
        }),
        { status: 200 },
      ),
    );
    const out = await embedBatch(['first', 'second'], TEST_OPTS);
    expect(out).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
  });

  it('throws a useful error on non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('boom', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(embedBatch(['x'], TEST_OPTS)).rejects.toThrow(/Embedding request failed: 503/);
  });

  it('throws when CAMPUS_LLM_BASE_URL is unset and no override is supplied', async () => {
    const prev = process.env.CAMPUS_LLM_BASE_URL;
    delete process.env.CAMPUS_LLM_BASE_URL;
    try {
      await expect(embedBatch(['x'], { apiKey: 'k' })).rejects.toThrow(/CAMPUS_LLM_BASE_URL not set/);
    } finally {
      if (prev !== undefined) process.env.CAMPUS_LLM_BASE_URL = prev;
    }
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });

  it('returns 0 when either vector is all zeros', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('throws on length mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/length mismatch/);
  });
});

describe('InMemoryVectorStore', () => {
  it('returns top-k results ranked by cosine similarity', () => {
    const store = new InMemoryVectorStore<{ label: string }>();
    store.upsert('a', [1, 0, 0], { label: 'east' });
    store.upsert('b', [0, 1, 0], { label: 'north' });
    store.upsert('c', [0.9, 0.1, 0], { label: 'mostly-east' });

    const hits = store.search([1, 0, 0], 2);
    expect(hits.map(h => h.id)).toEqual(['a', 'c']);
    expect(hits[0]!.score).toBeCloseTo(1, 10);
    expect(hits[0]!.meta.label).toBe('east');
  });

  it('upsert overwrites an existing id rather than duplicating it', () => {
    const store = new InMemoryVectorStore();
    store.upsert('a', [1, 0], {});
    store.upsert('a', [0, 1], {});
    expect(store.size()).toBe(1);
    const [hit] = store.search([0, 1], 1);
    expect(hit!.id).toBe('a');
    expect(hit!.score).toBeCloseTo(1, 10);
  });

  it('exposes EMBEDDING_DIM matching the qwen3-embedding-4b output', () => {
    expect(EMBEDDING_DIM).toBe(2560);
  });
});
