# Explore Thinking-Partner — Plan 2a: Agent Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the course-change thinking-partner **agent** — a sibling to `streamCurriculumChat` with the Plan-1 impact engine + scenario repo exposed as tools — streamed over the repurposed `/api/explore/[code]/chat` route, provable via a smoke harness. No UI yet (Plan 2b).

**Architecture:** `streamExploreAgent` mirrors `streamCurriculumChat`'s `provider.streamWithTools` loop but uses a specialized prompt + the reused grounding tools (`read_wiki`/`search_curriculum`/graph) **plus** new explore tools (`neighbor_context`, `estimate_impact`, `save_scenario`, `list_scenarios`, `compare_scenarios`). Because the provider stream has no tool-result event, the explore tools are built with an **emit-closure**: `estimate_impact`/`compare_scenarios` push their structured `Scenario`/comparison to a per-turn buffer, and the generator yields them as new `scenario`/`comparison` stream events (so the future UI can render cards). Only `estimate_impact` mints numbers; the agent reasons but never states its own.

**Tech Stack:** TypeScript strict, Zod, Vitest. Builds on merged Plan-1 (`lib/ai/explore/*`, `explore-scenario-queries.ts`) and the agent framework (`lib/ai/wiki/chat.ts`, `lib/ai/tool-use-types.ts`).

**Spec:** [`2026-07-08-explore-thinking-partner-agent-ui-design.md`](../specs/2026-07-08-explore-thinking-partner-agent-ui-design.md). Plan 2b (UI + retirement) follows.

---

## Reused interfaces (read before starting)

- `ToolDefinition = { name; description; usagePolicy; inputSchema: ZodType; execute: (args:unknown)=>Promise<unknown> }` — `lib/ai/tool-use-types.ts:15`. Pattern example: `lib/ai/wiki/curriculum-search-tool.ts`.
- `streamCurriculumChat` — `lib/ai/wiki/chat.ts:51` — the generator to mirror (`provider.streamWithTools<T>({ systemPrompt, messages, tools, schemaName, jsonSchema, validate, maxToolCalls })`; `StreamEvent<T>` kinds: `tool-start`/`text-delta`/`final`/`error`, `lib/ai/tool-use-types.ts:125`).
- Grounding tool builders: `buildCurriculumChatTools()` (`lib/ai/wiki/tools.ts`), `buildCurriculumGraphTools()` (`graph-tools.ts`), `buildCurriculumSearchTools()` (`curriculum-search-tool.ts`).
- Plan-1: `runImpact(courseCode, changeProse): Promise<Scenario>` (`lib/ai/explore/run-impact.ts`, persists the scenario), `saveScenario`/`listScenarios`/`getScenario` (`lib/db/explore-scenario-queries.ts`), `compareScenarios(a,b): ScenarioComparison` (`lib/ai/explore/compare.ts`), `Scenario` (`scenario.ts`). The DB-backed neighbor load lives inside `run-impact.ts` — extract a reusable `loadNeighborContext(courseCode)` if not already exported.
- Prompt loader + response-schema pattern: `lib/ai/wiki/response-schema.ts` (`CurriculumChatResponseSchema` + `…JsonSchema`), `loadPrompt`, `getProviderForFunction`, `lib/ai/prompts/load.ts` (`PromptName` union), `lib/ai/function-settings.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/ai/explore/agent-tools.ts` | **NEW** — `buildExploreTools(courseCode, emit)` → the 5 explore `ToolDefinition`s. |
| `lib/ai/explore/agent-response-schema.ts` | **NEW** — the agent's `final` response schema (`{ response, citations }`) — Zod + strict JSON. |
| `lib/ai/explore/agent.ts` | **NEW** — `streamExploreAgent` generator (mirrors `streamCurriculumChat` + emit buffer + `scenario`/`comparison` events). |
| `lib/ai/prompts/explore-agent.md` | **NEW** — the thinking-partner system prompt. |
| `lib/ai/prompts/load.ts`, `lib/ai/function-settings.ts` | Modify — register `explore-agent`. |
| `app/api/explore/[code]/chat/route.ts` | Modify — stream `streamExploreAgent` (forward new events as NDJSON). |
| `scripts/_one-off/explore-agent-harness.ts` | **NEW** — drive the agent over a real course, eyeball output. |

---

## Task 1: Explore agent tools (`buildExploreTools`)

**Files:** Create `lib/ai/explore/agent-tools.ts`; Test `tests/lib/ai/explore/agent-tools.test.ts`.

The 5 tools wrap Plan-1 functions. `estimate_impact` and `compare_scenarios` call `emit(...)` so the generator can surface their structured payload; all tools also return a compact value for the model.

- [ ] **Step 1: Write the failing test** (tool contracts against injected behavior — no live AI, no DB; we test that the tools are shaped right and that `estimate_impact` emits + returns a summary):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildExploreTools, type ExploreEmit } from '@/lib/ai/explore/agent-tools';

describe('buildExploreTools', () => {
  it('exposes the five explore tools with zod input schemas', () => {
    const tools = buildExploreTools('GC 3460', () => {});
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['compare_scenarios', 'estimate_impact', 'list_scenarios', 'neighbor_context', 'save_scenario']);
    for (const t of tools) {
      expect(typeof t.execute).toBe('function');
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.description).toBe('string');
    }
  });

  it('estimate_impact input schema requires a change string', () => {
    const t = buildExploreTools('GC 3460', () => {}).find(t => t.name === 'estimate_impact')!;
    expect(t.inputSchema.safeParse({ change: 'add a lab' }).success).toBe(true);
    expect(t.inputSchema.safeParse({}).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — module not found.

- [ ] **Step 3: Implement `lib/ai/explore/agent-tools.ts`.** Define the emit type and the factory. Each `execute` casts `args` (the framework validates against `inputSchema` before calling, per the curriculum-search-tool pattern) and returns a compact model-facing value; `estimate_impact`/`compare_scenarios` additionally `emit`.

```typescript
import { z } from 'zod';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';
import { runImpact, loadNeighborContext } from './run-impact';
import { compareScenarios, type ScenarioComparison } from './compare';
import { saveScenario, listScenarios, getScenario } from '@/lib/db/explore-scenario-queries';
import type { Scenario } from './scenario';

export type ExploreEmit =
  | { kind: 'scenario'; scenario: Scenario }
  | { kind: 'comparison'; a: Scenario; b: Scenario; diff: ScenarioComparison };

/** Compact, model-facing summary of a scenario (the full object goes to the UI via emit, not the model). */
function summarize(s: Scenario): string {
  const deltas = s.predictedDeltas.map(d => `${d.competency}: D${d.from.d}→${d.to.d} (${d.confidence})`).join('; ');
  const ripple = s.computedRipple.map(r => `${r.kind}:${r.label} ${r.before}→${r.after}`).join('; ');
  return `scenario ${s.id}. predicted: ${deltas || 'none'}. ripple: ${ripple || 'none (data-sparse)'}.`;
}

export function buildExploreTools(courseCode: string, emit: (e: ExploreEmit) => void): ToolDefinition[] {
  return [
    {
      name: 'neighbor_context',
      description: 'Get THIS course’s snapshot plus its upstream (courses it relies on) and downstream (courses that rely on it) neighbors — their competencies and incoming expectations. Use to ground reasoning about how a change ripples up/down the curriculum.',
      usagePolicy: 'No args needed beyond the anchored course. Returns focal + upstream[] + downstream[] profiles.',
      inputSchema: z.object({}),
      async execute() {
        return await loadNeighborContext(courseCode);
      },
    },
    {
      name: 'estimate_impact',
      description: 'Predict the effect of a proposed change to THIS course: the local KUD deltas + the computed up/downstream/career ripple. Call this when a concrete impact read sharpens the conversation. Returns a scenario summary; the full scenario is shown to the faculty as a card. Predictions are hypotheses, not measurements.',
      usagePolicy: 'Pass `change`: a plain-language description of the proposed change (assignment/project/rubric/content). One estimate per call.',
      inputSchema: z.object({ change: z.string().min(1) }),
      async execute(args) {
        const { change } = args as { change: string };
        const scenario = await runImpact(courseCode, change);
        emit({ kind: 'scenario', scenario });
        return { summary: summarize(scenario), scenarioId: scenario.id };
      },
    },
    {
      name: 'save_scenario',
      description: 'Name/keep a scenario so it is easy to find and compare later. Sets a caption on an existing scenario (produced by estimate_impact).',
      usagePolicy: 'Pass `scenarioId` and a short `caption`.',
      inputSchema: z.object({ scenarioId: z.string().min(1), caption: z.string().min(1) }),
      async execute(args) {
        const { scenarioId, caption } = args as { scenarioId: string; caption: string };
        const s = await getScenario(scenarioId);
        if (!s) return { error: 'scenario not found' };
        await saveScenario({ ...s, caption });
        return { ok: true, scenarioId, caption };
      },
    },
    {
      name: 'list_scenarios',
      description: 'List scenarios saved for THIS course (newest first), with their captions, so you can recall or compare them.',
      usagePolicy: 'No args. Returns id + caption + a one-line summary each.',
      inputSchema: z.object({}),
      async execute() {
        const list = await listScenarios(courseCode);
        return { scenarios: list.map(s => ({ id: s.id, caption: s.caption ?? null, summary: summarize(s) })) };
      },
    },
    {
      name: 'compare_scenarios',
      description: 'Compare two saved scenarios for THIS course — which predicted deltas and ripple lines differ. Shows the faculty a side-by-side.',
      usagePolicy: 'Pass `aId` and `bId` (scenario ids).',
      inputSchema: z.object({ aId: z.string().min(1), bId: z.string().min(1) }),
      async execute(args) {
        const { aId, bId } = args as { aId: string; bId: string };
        const [a, b] = await Promise.all([getScenario(aId), getScenario(bId)]);
        if (!a || !b) return { error: 'one or both scenarios not found' };
        const diff = compareScenarios(a, b);
        emit({ kind: 'comparison', a, b, diff });
        return { deltaChanges: diff.deltaChanges.length, rippleOnlyInA: diff.rippleOnlyInA.length, rippleOnlyInB: diff.rippleOnlyInB.length };
      },
    },
  ];
}
```

> If `loadNeighborContext(courseCode)` is not yet exported from `run-impact.ts`, extract it there (the DB neighbor-load logic `runImpact` already performs internally) and export it — a small refactor that keeps the tool DRY.

- [ ] **Step 4: Run, verify PASS** — `pnpm vitest run tests/lib/ai/explore/agent-tools.test.ts`; `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add lib/ai/explore/agent-tools.ts lib/ai/explore/run-impact.ts tests/lib/ai/explore/agent-tools.test.ts && git commit -m "feat(explore): agent tool wrappers (neighbor_context, estimate_impact, save/list/compare)"`

---

## Task 2: Agent response schema + prompt + function registration

**Files:** Create `lib/ai/explore/agent-response-schema.ts`, `lib/ai/prompts/explore-agent.md`; Modify `lib/ai/prompts/load.ts`, `lib/ai/function-settings.ts`; Test `tests/lib/ai/explore/agent-response-schema.test.ts`.

- [ ] **Step 1: Write the failing test** (the final response schema — mirror `CurriculumChatResponseSchema` shape `{ response, citations }`):

```typescript
import { describe, it, expect } from 'vitest';
import { ExploreAgentResponseSchema, ExploreAgentResponseJsonSchema } from '@/lib/ai/explore/agent-response-schema';

describe('ExploreAgentResponseSchema', () => {
  it('accepts a response with citations', () => {
    expect(ExploreAgentResponseSchema.safeParse({ response: 'here is my read', citations: [] }).success).toBe(true);
  });
  it('strict JSON schema: required === properties (OpenAI strict-mode)', () => {
    const s: any = ExploreAgentResponseJsonSchema;
    expect(new Set(s.required)).toEqual(new Set(Object.keys(s.properties)));
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement the schema** by mirroring `lib/ai/wiki/response-schema.ts` (`CurriculumChatResponseSchema`/`…JsonSchema` — `{ response: string, citations: [...] }`). Reuse its citation shape verbatim (import + re-export, or copy the citation subschema). Keep it minimal: the card data rides the `scenario`/`comparison` stream events, NOT this response — so this schema stays exactly the curriculum-chat shape.

- [ ] **Step 4: Write the prompt** `lib/ai/prompts/explore-agent.md` (frontmatter `name: explore-agent`, includes `shared/depth-scale.md`). Role: a **course-change thinking partner** anchored to one course. **Co-thinker, not oracle.** Two directions: *predict* ("here's my change" → reason about implications, call `estimate_impact` when a concrete read helps) and *suggest* ("here's my goal" → bounce candidate changes, optionally `estimate_impact` each). Ground every claim in the tools: `neighbor_context` for up/downstream, `search_curriculum` for real assignments/rubrics, `read_wiki`/graph tools for structure. **Discipline:** only `estimate_impact` may state KUD/ripple numbers; you reason expansively (displacement, coherence, redundancy, what-to-check) but never assert your own depth/coverage figures as fact; predictions are hypotheses held loosely. Save/recall/compare scenarios via the tools when the faculty wants to keep or weigh options.

- [ ] **Step 5: Register the function id** — add `'explore-agent'` to `AI_FUNCTION_IDS`/`DEFAULT_TIERS` (default tier, like `curriculum-chat`)/labels in `function-settings.ts`, and to the `PromptName` union in `load.ts`.

- [ ] **Step 6: Run, verify PASS** (`pnpm vitest run tests/lib/ai/explore/agent-response-schema.test.ts`), `pnpm tsc --noEmit` clean.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(explore): agent response schema + thinking-partner prompt + function registration"`

---

## Task 3: `streamExploreAgent` generator

**Files:** Create `lib/ai/explore/agent.ts`; Test `tests/lib/ai/explore/agent.test.ts`.

Mirror `streamCurriculumChat` but: build tools with the emit-closure buffer, and yield `scenario`/`comparison` events for whatever the tools emitted this turn (drained after the provider stream, before `final`).

- [ ] **Step 1: Write the failing test** for the event-type surface + the emit-buffer draining, using a fake provider (mirror how the codebase fakes `streamWithTools` — check for a `FakeProvider` in tests; if present, script a run where `estimate_impact` fires; else test the pure `drainEmitted` helper). Minimum: unit-test a pure helper `collectEmitted(emitted): ExploreAgentStreamEvent[]` that maps buffered `ExploreEmit`s to `scenario`/`comparison` stream events:

```typescript
import { describe, it, expect } from 'vitest';
import { emittedToEvents } from '@/lib/ai/explore/agent';
import type { Scenario } from '@/lib/ai/explore/scenario';

const s = { id: 'x', courseCode: 'GC 3460', baselineSnapshotId: 'b', change: { prose:'p',activity:'a',artifact:'graded',competencies:[],rubricCriteria:[],assumesIncoming:[] }, predictedDeltas: [], computedRipple: [], createdAt: '2026-07-08T00:00:00.000Z' } as unknown as Scenario;

describe('emittedToEvents', () => {
  it('maps a scenario emit to a scenario stream event', () => {
    const evs = emittedToEvents([{ kind: 'scenario', scenario: s }]);
    expect(evs).toEqual([{ kind: 'scenario', scenario: s }]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `lib/ai/explore/agent.ts`** mirroring `streamCurriculumChat` (`lib/ai/wiki/chat.ts`) exactly for the provider loop, with these differences: (a) `loadPrompt('explore-agent')` + `getProviderForFunction('explore-agent')`; (b) `const emitted: ExploreEmit[] = []; const tools = [...buildCurriculumChatTools(), ...buildCurriculumGraphTools(), ...buildCurriculumSearchTools(), ...buildExploreTools(courseCode, e => emitted.push(e))];`; (c) use `ExploreAgentResponseSchema`/`…JsonSchema`; (d) define the event union `ExploreAgentStreamEvent = { kind:'tool-start'; ... } | { kind:'text-delta'; ... } | { kind:'scenario'; scenario:Scenario } | { kind:'comparison'; a:Scenario; b:Scenario; diff:ScenarioComparison } | { kind:'final'; response; toolCallsUsed:number } | { kind:'error'; message:string }`; (e) export the pure `emittedToEvents(emitted: ExploreEmit[]): ExploreAgentStreamEvent[]`; (f) after the provider loop's `for await` completes (before yielding `final`), `for (const ev of emittedToEvents(emitted)) yield ev;` so cards arrive at the end of the turn. Signature: `streamExploreAgent({ courseCode, anchorContext?, messages }): AsyncGenerator<ExploreAgentStreamEvent>`.

- [ ] **Step 4: Run, verify PASS**, `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(explore): streamExploreAgent (grounding + explore tools; emits scenario/comparison stream events)"`

---

## Task 4: Repurpose the chat route

**Files:** Modify `app/api/explore/[code]/chat/route.ts`; Test `tests/app/api/explore-chat-route.test.ts` (light).

- [ ] **Step 1: Write a light failing test** asserting the route module still exports a POST and (via a mocked `streamExploreAgent`) that a `scenario` event is serialized into the NDJSON body. If mocking the stream is heavy, instead assert the route imports `streamExploreAgent` (not `streamCurriculumChat`) — a grep-style module test:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
it('chat route streams the explore agent', () => {
  const src = readFileSync('app/api/explore/[code]/chat/route.ts', 'utf8');
  expect(src).toContain('streamExploreAgent');
  expect(src).not.toContain('streamCurriculumChat');
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Modify the route** — swap `streamCurriculumChat` for `streamExploreAgent(courseCode, ...)`, keep the slug-auth + IP rate-limit + focal-course anchor it already has. In the NDJSON serialization loop, forward the new `scenario` and `comparison` events verbatim (they're already plain JSON). Keep `maxDuration`.

- [ ] **Step 4: Run, verify PASS**, `pnpm tsc --noEmit` clean, `pnpm vitest run tests/app/api/` green.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(explore): repurpose /api/explore/[code]/chat to stream the thinking-partner agent"`

---

## Task 5: Agent smoke harness — prove the agent

**Files:** Create `scripts/_one-off/explore-agent-harness.ts`.

- [ ] **Step 1: Implement** a tsx script that drives `streamExploreAgent({ courseCode: argv[2], messages: [{ role:'user', content: argv[3] }] })`, prints each stream event (tool-start with name, text deltas concatenated, any `scenario`/`comparison` payloads, final), and the tool-call count.

- [ ] **Step 2: Run it** on a real captured course with both a predict prompt and a suggest prompt, e.g.:
  `pnpm tsx --env-file=.env.local scripts/_one-off/explore-agent-harness.ts "GC 3460" "I'm thinking about adding a trapping lab — what would that do, and what should I watch out for?"`
  `pnpm tsx --env-file=.env.local scripts/_one-off/explore-agent-harness.ts "GC 3460" "How could I make this course build better toward prepress careers?"`

- [ ] **Step 3: Eyeball** — does the agent (a) ground its reasoning in neighbors/spine (names real neighbor courses / real materials), (b) call `estimate_impact` when a concrete read helps and emit a `scenario` event, (c) reason as a co-thinker (displacement/coherence/what-to-check) WITHOUT asserting its own numbers, (d) handle the suggest direction (bounce ideas)? Capture the raw transcript in the commit body — this is the go/no-go for Plan 2b (the UI).

- [ ] **Step 4: Commit** — `git commit --allow-empty -m "chore(explore): agent smoke harness + prove-the-agent transcript"` with the transcript + read in the body.

- [ ] **Step 5: Update STATE.md** — note Plan 2a (agent backend) landed on branch, the new `explore-agent` function id + `streamExploreAgent` + the repurposed chat route (it now streams the explore agent, not curriculum-chat), and the smoke-harness outcome. (STATE.md ritual: new AI function id, route behavior change.) Commit STATE.md.

---

## Notes for the implementer

- **Only `estimate_impact` mints numbers.** The prompt must hold the agent to reasoning-not-asserting on figures; the harness (Task 5) is where you verify it actually behaves.
- **`estimate_impact` persists** (via `runImpact`, which saves). `save_scenario` just adds a caption to make it findable — every estimate is already a stored row (cheap). That's intentional; do not add a separate persistence path.
- **Cards arrive end-of-turn** in v1 (emit buffer drained after the provider loop). Mid-stream interleaving (a card exactly where the agent references it) is a Plan-2b polish if the UX needs it — don't build the async-queue interleave now.
- **Nothing here retires the old machinery or touches UI** — that's Plan 2b. This plan only adds + repurposes the one route.
- **The `/ask` standalone + `/wiki` chat still use `streamCurriculumChat`** — only the Explore chat route swaps to the explore agent. Confirm you didn't change the shared curriculum-chat agent.
