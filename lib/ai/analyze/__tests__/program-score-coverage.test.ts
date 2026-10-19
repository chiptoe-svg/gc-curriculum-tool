// P0b Task 5: coverage scoring moved from per-target to per-competency —
// the prompt and user message now carry NO career-target context (no
// target name, no career_target_id), and the scorer drops any returned
// cell whose competency_id wasn't in the input (replaces P0a Ruling 10's
// per-target member filter, which lived in the routes).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/provider')>('@/lib/ai/provider');
  return { ...actual, getProviderForFunction: vi.fn() };
});

import { getProviderForFunction } from '@/lib/ai/provider';
import { scoreSnapshotCompetencies } from '@/lib/ai/analyze/program-score-coverage';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

const FIVE_TARGET_NAMES = ['Production Operations', 'Brand Strategy', 'Account Management', 'Creative Generalist', 'AI Workflow'];

function validCell(competencyId: string) {
  return {
    competency_id: competencyId,
    matched_competency: null,
    k_depth: 1,
    u_depth: 1,
    d_depth: 1,
    evidence_excerpt: null,
    confidence: 'high' as const,
    rationale: 'r',
  };
}

const COMPETENCIES = [
  { id: 'comp-1', name: 'Comp One', knowDescriptor: 'k1', understandDescriptor: 'u1', doDescriptor: 'd1', foundational: false, scoring: 'direct' as const },
  { id: 'comp-2', name: 'Comp Two', knowDescriptor: 'k2', understandDescriptor: 'u2', doDescriptor: 'd2', foundational: false, scoring: 'direct' as const },
];

function makeProvider(cells: unknown[]) {
  const complete = vi.fn(async (args: { userMessage: string }) => ({
    data: { snapshot_id: 'snap-1', generated_at: new Date().toISOString(), cells },
    costUsdCents: 5,
    durationMs: 1,
    cachedTokens: 0,
    uncachedPromptTokens: 1,
    completionTokens: 1,
    // stash the captured userMessage on the telemetry object so the test can inspect it
    __userMessage: args.userMessage,
  }));
  return { name: 'openai' as const, model: 'test-model', complete, completeWithTools: vi.fn(), transcribeDocument: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scoreSnapshotCompetencies — no career-target context', () => {
  it('the captured user message carries the competencies\' descriptors and no career-target name or id', async () => {
    const provider = makeProvider([validCell('comp-1'), validCell('comp-2')]);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    await scoreSnapshotCompetencies({
      snapshotId: 'snap-1',
      courseCode: 'GC 1010',
      snapshotProfile: {} as unknown as CaptureProfile,
      competencies: COMPETENCIES,
    });

    expect(provider.complete).toHaveBeenCalledTimes(1);
    const { userMessage } = provider.complete.mock.calls[0]![0] as { userMessage: string };

    // Carries the competencies' own descriptors.
    expect(userMessage).toContain('k1');
    expect(userMessage).toContain('u1');
    expect(userMessage).toContain('d1');
    expect(userMessage).toContain('comp-1');

    // Carries none of the five career-target names.
    for (const name of FIVE_TARGET_NAMES) {
      expect(userMessage).not.toContain(name);
    }
    // Carries no career_target_id field.
    expect(userMessage).not.toContain('career_target_id');
    expect(userMessage).not.toContain('careerTarget');
  });

  it('drops cells for competency ids that were not in the input', async () => {
    const provider = makeProvider([validCell('comp-1'), validCell('off-catalog')]);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    const { result } = await scoreSnapshotCompetencies({
      snapshotId: 'snap-1',
      courseCode: 'GC 1010',
      snapshotProfile: {} as unknown as CaptureProfile,
      competencies: COMPETENCIES,
    });

    expect(result.cells.map(c => c.competency_id)).toEqual(['comp-1']);
  });

  it('keeps every cell when all are in the input (no false drops)', async () => {
    const provider = makeProvider([validCell('comp-1'), validCell('comp-2')]);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    const { result } = await scoreSnapshotCompetencies({
      snapshotId: 'snap-1',
      courseCode: 'GC 1010',
      snapshotProfile: {} as unknown as CaptureProfile,
      competencies: COMPETENCIES,
    });

    expect(result.cells.map(c => c.competency_id).sort()).toEqual(['comp-1', 'comp-2']);
  });

  it('uses the program_coverage_v2 schema name', async () => {
    const provider = makeProvider([validCell('comp-1'), validCell('comp-2')]);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    await scoreSnapshotCompetencies({
      snapshotId: 'snap-1',
      courseCode: 'GC 1010',
      snapshotProfile: {} as unknown as CaptureProfile,
      competencies: COMPETENCIES,
    });

    const call = provider.complete.mock.calls[0]![0] as unknown as { schemaName: string };
    expect(call.schemaName).toBe('program_coverage_v2');
  });
});

// ---------------------------------------------------------------------------
// Strict-mode walker (pattern from lib/ai/agent/audit-response-schema.ts):
// every key in `properties` must appear in `required`, recursively.
// ---------------------------------------------------------------------------
function assertStrictMode(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
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

describe('program-score-coverage JSON schema — OpenAI strict mode', () => {
  it('passes the strict-mode walker (every property listed in required, recursively)', async () => {
    const provider = makeProvider([validCell('comp-1')]);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    await scoreSnapshotCompetencies({
      snapshotId: 'snap-1',
      courseCode: 'GC 1010',
      snapshotProfile: {} as unknown as CaptureProfile,
      competencies: COMPETENCIES,
    });

    const call = provider.complete.mock.calls[0]![0] as unknown as { jsonSchema: object };
    assertStrictMode(call.jsonSchema);
  });
});

// ---------------------------------------------------------------------------
// Catalog foundationals: derived competencies are never scored; foundational
// competencies are D-only and the scorer rejects numeric K/U for them.
// ---------------------------------------------------------------------------
const DERIVED = { id: 'comp-derived', name: 'Derived One', knowDescriptor: null, understandDescriptor: null, doDescriptor: 'dd', foundational: false, scoring: 'derived' as const };
const FOUND = { id: 'comp-found', name: 'Found One', knowDescriptor: null, understandDescriptor: null, doDescriptor: 'df', foundational: true, scoring: 'direct' as const };

/** A provider whose complete() runs the caller's validate, like the real ones. */
function makeValidatingProvider(cells: unknown[]) {
  const complete = vi.fn(async (args: { validate: (raw: unknown) => unknown }) => ({
    data: args.validate({ snapshot_id: 'snap-1', generated_at: 'now', cells }),
    costUsdCents: 5, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 1, completionTokens: 1,
  }));
  return { name: 'openai' as const, model: 'test-model', complete, completeWithTools: vi.fn(), transcribeDocument: vi.fn() };
}
const baseInput = { snapshotId: 'snap-1', courseCode: 'GC 1010', snapshotProfile: {} as unknown as CaptureProfile };

describe('scoreSnapshotCompetencies — derived and foundational', () => {
  it('a derived competency is not in the user message and gets no cell', async () => {
    const provider = makeProvider([validCell('comp-1'), validCell('comp-derived')]);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);
    const { result } = await scoreSnapshotCompetencies({ ...baseInput, competencies: [COMPETENCIES[0]!, DERIVED] });
    const { userMessage } = provider.complete.mock.calls[0]![0] as { userMessage: string };
    expect(userMessage).not.toContain('comp-derived');
    expect(result.cells.map(c => c.competency_id)).toEqual(['comp-1']);
  });

  it('with only derived input the provider is never called and cost is 0', async () => {
    const provider = makeProvider([]);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);
    const out = await scoreSnapshotCompetencies({ ...baseInput, competencies: [DERIVED] });
    expect(provider.complete).not.toHaveBeenCalled();
    expect(out.result.cells).toEqual([]);
    expect(out.costUsdCents).toBe(0);
    expect(out.model).toBe('test-model');
  });

  it('each competency in the user message carries its foundational flag', async () => {
    const provider = makeProvider([validCell('comp-1'), validCell('comp-found')]);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);
    await scoreSnapshotCompetencies({ ...baseInput, competencies: [COMPETENCIES[0]!, FOUND] });
    const { userMessage } = provider.complete.mock.calls[0]![0] as { userMessage: string };
    const json = userMessage.split('**Competencies to score:**')[1]!.split('---')[0]!;
    const arr = JSON.parse(json) as Array<{ id: string; foundational: boolean }>;
    expect(arr.find(c => c.id === 'comp-1')!.foundational).toBe(false);
    expect(arr.find(c => c.id === 'comp-found')!.foundational).toBe(true);
  });

  it('drops a foundational cell with numeric K/U, reports its id, keeps others and returns cost', async () => {
    const provider = makeValidatingProvider([
      { ...validCell('comp-found'), k_depth: 2, u_depth: null },
      validCell('comp-1'),
    ]);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);
    const out = await scoreSnapshotCompetencies({ ...baseInput, competencies: [COMPETENCIES[0]!, FOUND] });
    expect(out.result.cells.map(c => c.competency_id)).toEqual(['comp-1']);
    expect(out.rejectedCompetencyIds).toEqual(['comp-found']);
    expect(out.costUsdCents).toBe(5);
  });

  it('also drops a foundational cell with numeric u_depth alone', async () => {
    const provider = makeValidatingProvider([{ ...validCell('comp-found'), k_depth: null, u_depth: 1 }]);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(provider);
    const out = await scoreSnapshotCompetencies({ ...baseInput, competencies: [FOUND] });
    expect(out.result.cells).toEqual([]);
    expect(out.rejectedCompetencyIds).toEqual(['comp-found']);
  });

  it('the same numeric K/U validates for a non-foundational competency; null K/U validates for a foundational one', async () => {
    const p1 = makeValidatingProvider([{ ...validCell('comp-1'), k_depth: 2 }]);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(p1);
    const ok = await scoreSnapshotCompetencies({ ...baseInput, competencies: [COMPETENCIES[0]!] });
    expect(ok.result.cells[0]!.k_depth).toBe(2);
    expect(ok.rejectedCompetencyIds).toEqual([]);

    const p2 = makeValidatingProvider([{ ...validCell('comp-found'), k_depth: null, u_depth: null }]);
    (getProviderForFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(p2);
    const ok2 = await scoreSnapshotCompetencies({ ...baseInput, competencies: [FOUND] });
    expect(ok2.result.cells[0]!.k_depth).toBeNull();
  });
});
