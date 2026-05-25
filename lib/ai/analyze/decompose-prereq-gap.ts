import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import {
  skillsMergeSchema,
  skillsMergeJsonSchema,
  type SkillsMerge,
} from '@/lib/ai/schemas';

export interface MergePrereqGapArgs {
  /** The verbatim text of one prereq_gaps item from a capture profile. */
  gapText: string;
  /** Course code that the audit was about (provenance). */
  sourceCourseCode: string;
  /** The course's current skillsRequired list (the catalog cell value). */
  existingSkills: string[];
}

/**
 * Merges a free-form prereq-gap finding with a course's existing
 * skillsRequired list. Output is a unified list (existing items
 * preserved, new gap-derived items added with K/U/D depth tags) ready
 * to paste back into the Skills/Competencies Required cell.
 *
 * Named "decompose…" historically; kept for the function-settings ID
 * stability. The behavior is now merge-not-just-decompose.
 */
export async function mergePrereqGapWithSkills(args: MergePrereqGapArgs): Promise<SkillsMerge> {
  const systemPrompt = await loadPrompt('decompose-prereq-gap');
  const provider = await getProviderForFunction('decompose-prereq-gap');
  const existingBlock = args.existingSkills.length > 0
    ? args.existingSkills.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '(no existing entries — list is empty)';
  const userMessage = [
    `Source course: ${args.sourceCourseCode}`,
    '',
    'Existing Skills/Competencies Required:',
    existingBlock,
    '',
    'Gap finding:',
    args.gapText,
  ].join('\n');
  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'skills_merge',
    jsonSchema: skillsMergeJsonSchema,
    validate: (raw) => skillsMergeSchema.parse(raw),
  });
  return result.data;
}
