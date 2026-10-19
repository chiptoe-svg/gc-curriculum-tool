import type { CareerTarget } from '@/lib/domain/types';
import { isSubCompetencyDefinition } from '@/lib/domain/types';
import { formatDescriptorLines } from '@/lib/catalog/descriptors';

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
    for (const l of formatDescriptorLines(sc)) lines.push(`    ${l}`);
  }
  return lines.join('\n');
}
