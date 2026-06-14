import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import {
  reconcileProposalsSchema,
  reconcileProposalsJsonSchema,
  type ReconcileProposals,
  type ReconcileSection,
} from '@/lib/ai/schemas';

export interface ReconcileFeedbackArgs {
  section: ReconcileSection;
  items: unknown[];            // the section's current items (index-ordered)
  feedback: string;
  courseContext?: { code?: string; title?: string };
}

export async function reconcileFeedback(
  args: ReconcileFeedbackArgs,
): Promise<ReconcileProposals & { costUsdCents: number; model: string }> {
  const systemPrompt = await loadPrompt('reconcile-feedback');
  const provider = await getProviderForFunction('reconcile-feedback');
  const userMessage = [
    args.courseContext?.code ? `Course: ${args.courseContext.code} — ${args.courseContext.title ?? ''}` : '',
    `Section: ${args.section}`,
    '',
    'Current items (index-ordered):',
    JSON.stringify(args.items, null, 2),
    '',
    'Faculty feedback:',
    args.feedback,
  ].filter(Boolean).join('\n');
  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'reconcile_proposals',
    jsonSchema: reconcileProposalsJsonSchema,
    validate: (raw) => reconcileProposalsSchema.parse(raw),
  });
  return { ...result.data, costUsdCents: result.costUsdCents, model: provider.model };
}
