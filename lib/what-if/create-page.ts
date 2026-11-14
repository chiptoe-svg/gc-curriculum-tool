/**
 * Creates or updates a what-if's page: runs the estimate, builds the what-if
 * profile and effects, has the model write the prose, and saves everything in
 * one write at the very end. A cap hit or a failed call before that leaves the
 * previous page untouched. Only the what-if's own row is written; the wiki is
 * read, never written.
 */
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { addWhatIfUsage, listActiveSubCompetencies, listWhatIfMessages, saveWhatIfPage, type WhatIfRow } from '@/lib/db/what-if-queries';
import { readWikiPage } from '@/lib/wiki/git-ops';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { AiCreditsExhaustedError } from '@/lib/ai/credit-status';
import type { CompletionTelemetry } from '@/lib/ai/provider';
import { attachmentsForAi } from './attachments';
import { estimateAttachments } from './estimate-attachments';
import { estimateWhatIf } from './estimate';
import { buildWhatIfProfile } from './profile';
import { computeKnockOn } from './knock-on';
import { loadWhatIfNeighborContext } from './neighbors';
import { writeWhatIfProse } from './page-prose';

export type CreatePageResult = { ok: true } | { ok: false; reason: 'baseline_withdrawn' | 'daily_cap' | 'prose_failed' };

const usageOf = (t: CompletionTelemetry) => ({
  costUsdCents: t.costUsdCents,
  promptTokens: t.cachedTokens + t.uncachedPromptTokens,
  completionTokens: t.completionTokens,
});

export async function createWhatIfPage(whatIf: WhatIfRow): Promise<CreatePageResult> {
  // The base version must still exist and still be the approved one, before any AI call.
  if (!whatIf.baseSnapshotId) return { ok: false, reason: 'baseline_withdrawn' };
  const base = await getSnapshotById(whatIf.baseSnapshotId);
  if (!base || base.retiredAt) return { ok: false, reason: 'baseline_withdrawn' };
  const baseSnapshotId = whatIf.baseSnapshotId;
  const approved = base.profile;

  if (!(await checkDailyCap()).ok) return { ok: false, reason: 'daily_cap' };

  const [messages, attachments, neighborContext, catalog] = await Promise.all([
    listWhatIfMessages(whatIf.id),
    attachmentsForAi(whatIf.id),
    loadWhatIfNeighborContext(whatIf.courseCode, baseSnapshotId),
    listActiveSubCompetencies(),
  ]);

  const { estimate, telemetry: estimateTelemetry } = await estimateWhatIf({
    courseCode: whatIf.courseCode,
    approved,
    conversation: messages.map(m => ({ role: m.role, content: m.content })),
    attachments: estimateAttachments(attachments),
    neighborContext,
    catalog,
  });
  await recordSpend(estimateTelemetry.costUsdCents);
  await addWhatIfUsage(whatIf.id, 'estimate', usageOf(estimateTelemetry));

  const profile = buildWhatIfProfile(approved, estimate, new Set(catalog.map(c => c.id)));
  const knockOn = await computeKnockOn({ courseCode: whatIf.courseCode, baseSnapshotId }, profile);

  // The estimate is paid for and recorded; a cap reached now keeps the previous page.
  if (!(await checkDailyCap()).ok) return { ok: false, reason: 'daily_cap' };

  const slug = whatIf.courseCode.toLowerCase().replace(/\s+/g, '-');
  const wikiPage = await readWikiPage(`courses/${slug}.md`);
  const currentDescription = wikiPage ?? approved.overview?.narrative ?? '';
  const course = await getCourseByCode(whatIf.courseCode);

  let written: Awaited<ReturnType<typeof writeWhatIfProse>>;
  try {
    written = await writeWhatIfProse({
      courseCode: whatIf.courseCode,
      courseTitle: course?.title ?? whatIf.courseCode,
      currentDescription,
      estimate,
      profile,
      knockOn,
      needsTitle: !whatIf.title,
    });
  } catch (err) {
    if (err instanceof AiCreditsExhaustedError) throw err;
    return { ok: false, reason: 'prose_failed' };
  }
  await recordSpend(written.telemetry.costUsdCents);
  await addWhatIfUsage(whatIf.id, 'page', usageOf(written.telemetry));

  // The only write of page content. It replaces the previous page in one statement.
  await saveWhatIfPage(whatIf.id, {
    title: written.title,
    summary: written.summary,
    estimate,
    profile,
    knockOn,
    prose: written.prose,
  });
  return { ok: true };
}
