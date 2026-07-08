import { z } from 'zod';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';
import { runImpact, loadNeighborContext } from './run-impact';
import { compareScenarios, type ScenarioComparison } from './compare';
import { saveScenario, listScenarios, getScenario } from '@/lib/db/explore-scenario-queries';
import type { Scenario } from './scenario';

export type ExploreEmit =
  | { kind: 'scenario'; scenario: Scenario }
  | { kind: 'comparison'; a: Scenario; b: Scenario; diff: ScenarioComparison };

function summarize(s: Scenario): string {
  const deltas = s.predictedDeltas.map(d => `${d.competency}: D${d.from.d}→${d.to.d} (${d.confidence})`).join('; ');
  const ripple = s.computedRipple.map(r => `${r.kind}:${r.label} ${r.before}→${r.after}`).join('; ');
  return `scenario ${s.id} — "${s.change.activity}". predicted: ${deltas || 'none'}. ripple: ${ripple || 'none (data-sparse)'}.`;
}

export function buildExploreTools(courseCode: string, emit: (e: ExploreEmit) => void): ToolDefinition[] {
  return [
    {
      name: 'neighbor_context',
      description: 'Get THIS course\'s snapshot plus its upstream (courses it relies on) and downstream (courses that rely on it) neighbors — their competencies and incoming expectations. Use to ground reasoning about how a change ripples up/down the curriculum.',
      usagePolicy: 'No args needed beyond the anchored course. Returns focal + upstream[] + downstream[] profiles.',
      inputSchema: z.object({}),
      async execute() {
        return (await loadNeighborContext(courseCode)).context;
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
