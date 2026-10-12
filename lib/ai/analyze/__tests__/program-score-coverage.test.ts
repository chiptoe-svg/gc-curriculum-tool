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
  { id: 'comp-1', name: 'Comp One', knowDescriptor: 'k1', understandDescriptor: 'u1', doDescriptor: 'd1' },
  { id: 'comp-2', name: 'Comp Two', knowDescriptor: 'k2', understandDescriptor: 'u2', doDescriptor: 'd2' },
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
