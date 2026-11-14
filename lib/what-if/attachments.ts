import { extractText, type ExtractedMimeType } from '@/lib/courses/extract-text';
import { scrubForRecord } from '@/lib/privacy/scrub';
import { evaluateMaterialsPolicy } from '@/lib/capture/materials-policy';
import { detectFerpaRisk } from '@/lib/capture/ferpa-detect';
import { putLocal, safeFilename } from '@/lib/storage/local-storage';
import { recordSpend } from '@/lib/rate-limit/daily-cap';
import { insertWhatIfAttachment, listWhatIfAttachments, type WhatIfAttachmentRow } from '@/lib/db/what-if-queries';

export const WHAT_IF_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
/** Characters of attachment text handed to the assistant and the estimate, across one what-if. */
export const WHAT_IF_ATTACHMENT_TEXT_BUDGET = 120_000;

/**
 * Reads, screens and stores one attachment with its what-if. Screening matches the course-materials step
 * (scrub, then the materials policy, then the FERPA check). Nothing here touches course materials or the
 * shared search index: the text lives on the attachment row only.
 */
export async function ingestWhatIfAttachment(input: {
  whatIfId: string; fileName: string; mimeType: string; bytes: Buffer;
}): Promise<WhatIfAttachmentRow> {
  const { whatIfId, fileName, mimeType, bytes } = input;
  const stored = await putLocal({ key: `what-ifs/${whatIfId}/${Date.now()}-${safeFilename(fileName)}`, bytes });
  const base = {
    whatIfId, fileName, mimeType, sizeBytes: bytes.length, blobUrl: stored.url,
    heldBackReason: null, ferpaRisk: null, extractedText: null,
  };

  let extracted;
  try {
    extracted = await extractText({ fileBytes: bytes, mimeType: mimeType as ExtractedMimeType, fileName });
  } catch (err) {
    console.error('[what-if attachment] extraction threw:', err);
    return insertWhatIfAttachment({ ...base, status: 'failed' });
  }
  if (extracted.visionCostUsdCents) await recordSpend(extracted.visionCostUsdCents);
  if (extracted.status === 'failed' || !extracted.text || extracted.text.trim().length === 0) {
    return insertWhatIfAttachment({ ...base, status: 'failed' });
  }

  const scrubbed = await scrubForRecord(extracted.text, { fileName, isSyllabus: false });
  const policy = evaluateMaterialsPolicy({ fileName, extractedText: scrubbed.text, courseHasLearningObjectives: true });
  const ferpaRisk = detectFerpaRisk(scrubbed.text).level;
  if (!policy.included) {
    return insertWhatIfAttachment({ ...base, status: 'held_back', heldBackReason: policy.reason, ferpaRisk });
  }
  return insertWhatIfAttachment({ ...base, status: 'ok', ferpaRisk, extractedText: scrubbed.text });
}

/**
 * The attachments' text for the assistant and the estimate, oldest first, within the text budget.
 * Only 'ok' files carry text. The file that crosses the budget is cut and marked truncated; later 'ok'
 * files get no text and are marked truncated too.
 */
export async function attachmentsForAi(whatIfId: string): Promise<Array<{
  fileName: string; status: 'ok' | 'failed' | 'held_back'; text: string | null; truncated: boolean;
}>> {
  let remaining = WHAT_IF_ATTACHMENT_TEXT_BUDGET;
  return (await listWhatIfAttachments(whatIfId)).map((a) => {
    if (a.status !== 'ok' || !a.extractedText) return { fileName: a.fileName, status: a.status, text: null, truncated: false };
    if (a.extractedText.length <= remaining) {
      remaining -= a.extractedText.length;
      return { fileName: a.fileName, status: a.status, text: a.extractedText, truncated: false };
    }
    const text = remaining > 0 ? a.extractedText.slice(0, remaining) : null;
    remaining = 0;
    return { fileName: a.fileName, status: a.status, text, truncated: true };
  });
}
