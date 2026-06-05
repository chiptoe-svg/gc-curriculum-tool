import { listSubmittedPositionsForTarget, writeAggregateForTarget } from '@/lib/db/position-capture-queries';
import { getTargetById } from '@/lib/db/career-targets-queries';
import type { PositionProfileType } from './schema';

/**
 * v1 aggregate: deterministic Markdown side-by-side of all submitted,
 * non-superseded, interviewed position captures under a career target.
 * No AI; readable by faculty as raw signal. v2 may swap in an AI
 * synthesis pass that reads this layout + produces a target-level KUD+.
 */
export async function regenerateAggregate(targetId: string): Promise<{
  positionIds: string[];
  markdown: string;
}> {
  const target = await getTargetById(targetId);
  if (!target) throw new Error(`regenerateAggregate: career target not found: ${targetId}`);

  const positions = await listSubmittedPositionsForTarget(targetId);
  const interviewed = positions.filter(p => p.completeness === 'interviewed' && p.profile);

  const lines: string[] = [
    `# ${target.name} — aggregated position captures`,
    '',
    `_${interviewed.length} interviewed position${interviewed.length === 1 ? '' : 's'} contribute to this view._`,
    '',
  ];

  if (interviewed.length === 0) {
    lines.push('_No interviewed positions yet. Submit a position via the partner survey to populate this view._');
  } else {
    for (const pos of interviewed) {
      const profile = pos.profile as PositionProfileType;
      lines.push(`## ${pos.positionTitle ?? '(no title)'} — ${pos.company}`);
      lines.push(`_Captured ${pos.submittedAt?.toISOString().slice(0, 10) ?? '—'}_`);
      lines.push('');
      lines.push(`**Essence.** ${profile.essence.one_sentence}`);
      lines.push('');
      lines.push(`**Qualifying competencies (${profile.qualifying_competencies.length})**`);
      for (const c of profile.qualifying_competencies) {
        const kud = c.required_for_success;
        const kudStr = `K${kud.k_depth ?? '–'} U${kud.u_depth ?? '–'} D${kud.d_depth ?? '–'}`;
        lines.push(`- **${c.name}** _(${kudStr})_ — ${c.description}`);
      }
      if (profile.dealbreakers.length > 0) {
        lines.push('');
        lines.push(`**Dealbreakers**`);
        for (const db of profile.dealbreakers) {
          lines.push(`- ${db.description}`);
        }
      }
      if (profile.hiring_signals.length > 0) {
        lines.push('');
        lines.push(`**Hiring signals**`);
        for (const sig of profile.hiring_signals) {
          lines.push(`- _(${sig.weight})_ ${sig.signal}`);
        }
      }
      lines.push('');
      lines.push(`**Trajectory.** Year 1 — ${profile.trajectory.year_1}  Year 2-3 — ${profile.trajectory.year_2_to_3}`);
      lines.push('');
      lines.push(`> ${profile.partner_voice_summary.split('\n').join('\n> ')}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  const markdown = lines.join('\n');
  await writeAggregateForTarget({
    targetId,
    markdown,
    derivedFromPositionIds: interviewed.map(p => p.id),
  });

  return { positionIds: interviewed.map(p => p.id), markdown };
}
