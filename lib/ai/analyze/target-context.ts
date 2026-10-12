import type { CareerTarget } from '@/lib/domain/types';
import { isSubCompetencyDefinition } from '@/lib/domain/types';

export function buildTargetContext(target: CareerTarget | null): string {
  if (!target) return '';
  const lines: string[] = [
    `Career Target: ${target.name}`,
    `Definition: ${target.shortDefinition}`,
    `Defensibility note: ${target.defensibilityNote}`,
    '',
    'Sub-competencies:',
  ];
  // target is always DB-resolved here (lib/db/career-targets-queries.ts),
  // which never produces `{ ref }` entries — the filter is just the type guard.
  for (const sc of target.subCompetencies.filter(isSubCompetencyDefinition)) {
    lines.push(`- id=${sc.id} :: ${sc.name}`);
    lines.push(`    Know: ${sc.knowDescriptor}`);
    lines.push(`    Understand: ${sc.understandDescriptor}`);
    lines.push(`    Do: ${sc.doDescriptor}`);
  }
  return lines.join('\n');
}
