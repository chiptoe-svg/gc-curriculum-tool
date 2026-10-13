// Task 8 — placeBundle / buildPlacementUserMessage / interpretPlacements:
// mocks @/lib/ai/provider exactly as draft-bundle-card.test.ts and
// program-score-coverage.test.ts do, so no paid AI call ever happens here.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/provider')>('@/lib/ai/provider');
  return { ...actual, getProviderForFunction: vi.fn() };
});

import { getProviderForFunction } from '@/lib/ai/provider';
import {
  placeBundle,
  buildPlacementUserMessage,
  interpretPlacements,
  PLACEMENT_JSON_SCHEMA,
  type PlacementInput,
  type ElementDef,
} from '@/lib/ai/catalog/map-bundle-onet';
import type { BundleSummary, CardFields } from '@/lib/catalog/bundles';
import type { TaskGroup } from '@/lib/catalog/shortlist';

const BUNDLE: BundleSummary = {
  id: 'color-management',
  name: 'Color management',
  knowDescriptor: 'KNOW_MARKER',
  understandDescriptor: 'UNDERSTAND_MARKER',
  doDescriptor: 'DO_MARKER',
  origin: 'gc_authored',
};

const CARD: CardFields = {
  stratum: 'technical',
  includes: 'INCLUDES_MARKER',
  excludes: 'EXCLUDES_MARKER',
  distinctions: 'DISTINCTIONS_MARKER',
  positiveExamples: ['POS_ONE', 'POS_TWO'],
  negativeExamples: ['NEG_ONE', 'NEG_TWO'],
};

const ELEMENTS: ElementDef[] = [
  { elementId: '2.C.1.a', elementName: 'Color theory', domain: 'knowledge', description: 'KNOWLEDGE_DESC' },
  { elementId: '1.A.1.a', elementName: 'Oral comprehension', domain: 'abilities', description: 'ABILITIES_DESC' },
];

const TASKS: Array<TaskGroup & { rank: number }> = [
  { key: 'taskkey00000001', label: 'Calibrate color monitors for print proofing.', members: [{ taskId: 'T1001', onetSocCode: '27-1024.00' }], rank: 1 },
  {
    key: 'taskkey00000002',
    label: 'Review printed proofs against brand color standards.',
    members: [
      { taskId: 'T2002', onetSocCode: '27-1024.00' },
      { taskId: 'T9999', onetSocCode: '51-5111.00' },
    ],
    rank: 2,
  },
];

const INPUT: PlacementInput = { bundle: BUNDLE, card: CARD, elements: ELEMENTS, tasks: TASKS, release: '31.0' };

function makeProvider(data: unknown, costUsdCents = 11) {
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

describe('buildPlacementUserMessage', () => {
  const msg = buildPlacementUserMessage(INPUT);

  it("contains the bundle id and all three K/U/D descriptors", () => {
    expect(msg).toContain(BUNDLE.id);
    expect(msg).toContain('KNOW_MARKER');
    expect(msg).toContain('UNDERSTAND_MARKER');
    expect(msg).toContain('DO_MARKER');
  });

  it('contains every card field, including excludes and distinctions', () => {
    expect(msg).toContain('INCLUDES_MARKER');
    expect(msg).toContain('EXCLUDES_MARKER');
    expect(msg).toContain('DISTINCTIONS_MARKER');
    expect(msg).toContain('POS_ONE');
    expect(msg).toContain('NEG_ONE');
  });

  it('contains an E:<id> line with name and definition for every element, grouped under a heading per domain', () => {
    expect(msg).toContain('### knowledge');
    expect(msg).toContain('E:2.C.1.a — Color theory: KNOWLEDGE_DESC');
    expect(msg).toContain('### abilities');
    expect(msg).toContain('E:1.A.1.a — Oral comprehension: ABILITIES_DESC');
  });

  it('contains T1..Tn lines with task text in rank order', () => {
    const t1Index = msg.indexOf('T1 — Calibrate color monitors');
    const t2Index = msg.indexOf('T2 — Review printed proofs');
    expect(t1Index).toBeGreaterThan(-1);
    expect(t2Index).toBeGreaterThan(t1Index);
  });

  it('contains no O*NET-SOC codes (the model judges task text, not occupations)', () => {
    expect(msg).not.toContain('27-1024.00');
    expect(msg).not.toContain('51-5111.00');
  });
});

describe('interpretPlacements', () => {
  it('maps an E:x item to one onet_element row with onetSocCode null and release set', () => {
    const { rows } = interpretPlacements(INPUT, {
      placements: [{ item_id: 'E:2.C.1.a', position: 'core', rationale: 'r1' }],
      note: null,
    });
    expect(rows).toEqual([
      { source: 'onet_element', externalId: '2.C.1.a', externalLabel: 'Color theory', onetSocCode: null, release: '31.0', position: 'core', rationale: 'r1' },
    ]);
  });

  it('maps T2 to one row per member of the rank-2 group, all carrying the same position and rationale', () => {
    const { rows } = interpretPlacements(INPUT, {
      placements: [{ item_id: 'T2', position: 'related', rationale: 'r2' }],
      note: null,
    });
    expect(rows).toEqual([
      { source: 'onet_task', externalId: 'T2002', externalLabel: TASKS[1]!.label, onetSocCode: '27-1024.00', release: '31.0', position: 'related', rationale: 'r2' },
      { source: 'onet_task', externalId: 'T9999', externalLabel: TASKS[1]!.label, onetSocCode: '51-5111.00', release: '31.0', position: 'related', rationale: 'r2' },
    ]);
  });

  it('drops an unknown id and lists it in droppedIds', () => {
    const { rows, droppedIds } = interpretPlacements(INPUT, {
      placements: [
        { item_id: 'E:nope', position: 'core', rationale: 'r' },
        { item_id: 'T99', position: 'core', rationale: 'r' },
        { item_id: 'X', position: 'core', rationale: 'r' },
      ],
      note: null,
    });
    expect(rows).toEqual([]);
    expect(droppedIds).toEqual(['E:nope', 'T99', 'X']);
  });

  it('keeps the first occurrence of a duplicate item_id', () => {
    const { rows } = interpretPlacements(INPUT, {
      placements: [
        { item_id: 'E:2.C.1.a', position: 'core', rationale: 'first' },
        { item_id: 'E:2.C.1.a', position: 'fringe', rationale: 'second' },
      ],
      note: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rationale).toBe('first');
    expect(rows[0]!.position).toBe('core');
  });

  it('noCleanMatch is true when every placement is fringe', () => {
    const { noCleanMatch } = interpretPlacements(INPUT, {
      placements: [{ item_id: 'E:2.C.1.a', position: 'fringe', rationale: 'r' }],
      note: null,
    });
    expect(noCleanMatch).toBe(true);
  });

  it('noCleanMatch is true when there are no placements at all', () => {
    const { noCleanMatch } = interpretPlacements(INPUT, { placements: [], note: null });
    expect(noCleanMatch).toBe(true);
  });

  it('noCleanMatch is false when one placement is related', () => {
    const { noCleanMatch } = interpretPlacements(INPUT, {
      placements: [
        { item_id: 'E:1.A.1.a', position: 'fringe', rationale: 'r' },
        { item_id: 'T1', position: 'related', rationale: 'r' },
      ],
      note: null,
    });
    expect(noCleanMatch).toBe(false);
  });

  it('passes note through unchanged', () => {
    const { note } = interpretPlacements(INPUT, { placements: [], note: 'NOTE_MARKER' });
    expect(note).toBe('NOTE_MARKER');
  });
});

// ---------------------------------------------------------------------------
// Strict-mode walker (pattern from draft-bundle-card.test.ts /
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

describe('PLACEMENT_JSON_SCHEMA — OpenAI strict mode', () => {
  it('passes the strict-mode walker (every property listed in required, recursively; additionalProperties: false everywhere)', () => {
    assertStrictMode(PLACEMENT_JSON_SCHEMA);
  });

  it('note is a nullable string union', () => {
    expect(PLACEMENT_JSON_SCHEMA.properties.note).toEqual({ type: ['string', 'null'] });
  });

  it('placements.items is required-complete and additionalProperties:false', () => {
    const items = PLACEMENT_JSON_SCHEMA.properties.placements.items as unknown as { required: string[]; additionalProperties: boolean; properties: object };
    expect(items.additionalProperties).toBe(false);
    expect([...items.required].sort()).toEqual(['item_id', 'position', 'rationale']);
  });
});

describe('placeBundle', () => {
  it("calls getProviderForFunction with 'bundle-map-onet'", async () => {
    const provider = makeProvider({ placements: [], note: null });
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    await placeBundle(INPUT);

    expect(getProviderForFunction).toHaveBeenCalledWith('bundle-map-onet');
  });

  it('returns model and costUsdCents from the provider, and rows derived from the response', async () => {
    const provider = makeProvider({ placements: [{ item_id: 'E:2.C.1.a', position: 'core', rationale: 'r' }], note: 'n' }, 37);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    const result = await placeBundle(INPUT);

    expect(result.model).toBe('test-model');
    expect(result.costUsdCents).toBe(37);
    expect(result.rows).toHaveLength(1);
    expect(result.note).toBe('n');
    expect(result.noCleanMatch).toBe(false);
    expect(result.droppedIds).toEqual([]);
  });
});
