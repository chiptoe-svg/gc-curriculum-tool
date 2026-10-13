// Task 5 — draftBundleCard: mocks @/lib/ai/provider exactly as
// lib/ai/analyze/__tests__/program-score-coverage.test.ts does, so no paid
// AI call ever happens in this test file.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/provider')>('@/lib/ai/provider');
  return { ...actual, getProviderForFunction: vi.fn() };
});

import { getProviderForFunction } from '@/lib/ai/provider';
import { draftBundleCard, buildCardUserMessage, CARD_JSON_SCHEMA } from '@/lib/ai/catalog/draft-bundle-card';
import type { BundleSummary } from '@/lib/catalog/bundles';

const BUNDLE: BundleSummary = {
  id: 'customer-relationship-management',
  name: 'Customer relationship and service',
  knowDescriptor: 'KNOW_MARKER',
  understandDescriptor: 'UNDERSTAND_MARKER',
  doDescriptor: 'DO_MARKER',
  origin: 'gc_authored',
};

const OTHER: BundleSummary = {
  id: 'negotiation-persuasion',
  name: 'Negotiation and persuasion',
  knowDescriptor: 'other know',
  understandDescriptor: 'other understand',
  doDescriptor: 'other do',
  origin: 'gc_authored',
};

const CATALOG = [BUNDLE, OTHER];

function rawCard(overrides: Record<string, unknown> = {}) {
  return {
    stratum: 'business',
    includes: 'includes text',
    excludes: 'excludes text',
    distinctions: 'distinctions text',
    positive_examples: ['p1', 'p2'],
    negative_examples: ['n1', 'n2'],
    ...overrides,
  };
}

function makeProvider(data: unknown, costUsdCents = 7) {
  const complete = vi.fn(async (_args: { userMessage: string }) => ({
    data,
    costUsdCents,
    durationMs: 1,
    cachedTokens: 0,
    uncachedPromptTokens: 1,
    completionTokens: 1,
  }));
  return { name: 'openai' as const, model: 'test-model', complete, completeWithTools: vi.fn(), transcribeDocument: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildCardUserMessage', () => {
  it("contains the bundle's own id and descriptors, and every other catalog bundle's id and name", () => {
    const msg = buildCardUserMessage(BUNDLE, CATALOG);
    expect(msg).toContain(BUNDLE.id);
    expect(msg).toContain('KNOW_MARKER');
    expect(msg).toContain('UNDERSTAND_MARKER');
    expect(msg).toContain('DO_MARKER');
    expect(msg).toContain(OTHER.id);
    expect(msg).toContain(OTHER.name);
  });

  it('does not include the bundle itself in the "rest of the catalog" list', () => {
    const msg = buildCardUserMessage(BUNDLE, CATALOG);
    // The bundle's own id still appears (bullet above), but should not be
    // duplicated inside the JSON catalog block — isolate the one JSON array
    // in the message by its outermost brackets.
    const start = msg.indexOf('[');
    const end = msg.lastIndexOf(']');
    expect(start).toBeGreaterThan(-1);
    const catalogJson = msg.slice(start, end + 1);
    expect(JSON.parse(catalogJson) as unknown[]).toHaveLength(1);
  });
});

describe('draftBundleCard', () => {
  it("calls getProviderForFunction with 'bundle-card-draft'", async () => {
    const provider = makeProvider(rawCard());
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    await draftBundleCard(BUNDLE, CATALOG);

    expect(getProviderForFunction).toHaveBeenCalledWith('bundle-card-draft');
  });

  it('sends a userMessage containing the bundle id, its three descriptors, and every other catalog bundle id/name', async () => {
    const provider = makeProvider(rawCard());
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    await draftBundleCard(BUNDLE, CATALOG);

    const { userMessage } = provider.complete.mock.calls[0]![0] as { userMessage: string };
    expect(userMessage).toContain(BUNDLE.id);
    expect(userMessage).toContain('KNOW_MARKER');
    expect(userMessage).toContain('UNDERSTAND_MARKER');
    expect(userMessage).toContain('DO_MARKER');
    expect(userMessage).toContain(OTHER.id);
    expect(userMessage).toContain(OTHER.name);
  });

  it('maps the snake_case response fields to camelCase in the returned card', async () => {
    const provider = makeProvider(rawCard({ stratum: 'technical', positive_examples: ['pa', 'pb'], negative_examples: ['na', 'nb'] }));
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    const { card } = await draftBundleCard(BUNDLE, CATALOG);

    expect(card).toEqual({
      stratum: 'technical',
      includes: 'includes text',
      excludes: 'excludes text',
      distinctions: 'distinctions text',
      positiveExamples: ['pa', 'pb'],
      negativeExamples: ['na', 'nb'],
    });
  });

  it('passes costUsdCents through from the provider result', async () => {
    const provider = makeProvider(rawCard(), 42);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    const { costUsdCents, model } = await draftBundleCard(BUNDLE, CATALOG);

    expect(costUsdCents).toBe(42);
    expect(model).toBe('test-model');
  });
});

// ---------------------------------------------------------------------------
// Strict-mode walker (pattern from lib/ai/agent/audit-response-schema.ts and
// program-score-coverage.test.ts): every key in `properties` must appear in
// `required`, recursively, and every object must set additionalProperties: false.
// ---------------------------------------------------------------------------
function assertStrictMode(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
    expect(obj.additionalProperties).toBe(false);
    const propKeys = Object.keys(obj.properties as object);
    const required = (obj.required as string[] | undefined) ?? [];
    for (const key of propKeys) {
      expect(required, `property "${key}" must appear in required`).toContain(key);
    }
    for (const v of Object.values(obj.properties as object)) assertStrictMode(v);
  }
  if (obj.items) assertStrictMode(obj.items);
  if (obj.anyOf && Array.isArray(obj.anyOf)) for (const v of obj.anyOf) assertStrictMode(v);
}

describe('CARD_JSON_SCHEMA — OpenAI strict mode', () => {
  it('passes the strict-mode walker (every property listed in required, recursively; additionalProperties: false everywhere)', () => {
    assertStrictMode(CARD_JSON_SCHEMA);
  });
});
