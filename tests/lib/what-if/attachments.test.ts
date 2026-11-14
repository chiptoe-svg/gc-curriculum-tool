import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const extractText = vi.fn();
vi.mock('@/lib/courses/extract-text', () => ({ extractText: (...a: unknown[]) => extractText(...a) }));
const scrubForRecord = vi.fn();
vi.mock('@/lib/privacy/scrub', () => ({ scrubForRecord: (...a: unknown[]) => scrubForRecord(...a) }));
const putLocal = vi.fn();
vi.mock('@/lib/storage/local-storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage/local-storage')>('@/lib/storage/local-storage');
  return { ...actual, putLocal: (...a: unknown[]) => putLocal(...a) };
});
const recordSpend = vi.fn();
vi.mock('@/lib/rate-limit/daily-cap', () => ({ recordSpend: (...a: unknown[]) => recordSpend(...a) }));
const insertWhatIfAttachment = vi.fn();
const listWhatIfAttachments = vi.fn();
vi.mock('@/lib/db/what-if-queries', () => ({
  insertWhatIfAttachment: (...a: unknown[]) => insertWhatIfAttachment(...a),
  listWhatIfAttachments: (...a: unknown[]) => listWhatIfAttachments(...a),
}));

import {
  ingestWhatIfAttachment, attachmentsForAi, WHAT_IF_ATTACHMENT_TEXT_BUDGET,
} from '@/lib/what-if/attachments';

const whatIfId = '8b1f0c2e-0000-4000-8000-000000000001';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const bytes = Buffer.from('file');
const LONG = 'A real paragraph about color management in the press room. '.repeat(3);

beforeEach(() => {
  [extractText, scrubForRecord, putLocal, recordSpend, insertWhatIfAttachment, listWhatIfAttachments].forEach((m) => m.mockReset());
  putLocal.mockResolvedValue({ url: 'local:what-ifs/x', key: 'what-ifs/x' });
  scrubForRecord.mockResolvedValue({ text: 'SCRUBBED', redactions: {} });
  // The scrubbed text must pass the real policy (not malformed): use LONG where the policy should accept.
  insertWhatIfAttachment.mockImplementation(async (r: object) => ({ id: 'att-1', createdAt: new Date(), ...r }));
});

describe('ingestWhatIfAttachment', () => {
  it('stores scrubbed text for a readable file', async () => {
    extractText.mockResolvedValue({ status: 'ok', text: 'raw text with a name' });
    scrubForRecord.mockResolvedValue({ text: LONG, redactions: {} });
    const row = await ingestWhatIfAttachment({ whatIfId, fileName: 'plan.pdf', mimeType: 'application/pdf', bytes });
    expect(row).toMatchObject({ status: 'ok', extractedText: LONG, heldBackReason: null, whatIfId, sizeBytes: 4 });
    expect(putLocal.mock.calls[0]![0].key).toMatch(new RegExp(`^what-ifs/${whatIfId}/`));
    expect(scrubForRecord).toHaveBeenCalledWith('raw text with a name', { fileName: 'plan.pdf', isSyllabus: false });
    expect(['low', 'medium', 'high']).toContain(row.ferpaRisk);
  });

  it('holds back a file the materials step would hold back', async () => {
    extractText.mockResolvedValue({ status: 'ok', text: LONG });
    const row = await ingestWhatIfAttachment({ whatIfId, fileName: 'Canvas File: gradebook.xlsx', mimeType: XLSX, bytes });
    expect(row).toMatchObject({ status: 'held_back', heldBackReason: 'Filename looks like grades/roster data', extractedText: null });
  });

  it('marks an unreadable file failed', async () => {
    extractText.mockResolvedValue({ status: 'failed' });
    const row = await ingestWhatIfAttachment({ whatIfId, fileName: 'x.pdf', mimeType: 'application/pdf', bytes });
    expect(row).toMatchObject({ status: 'failed', extractedText: null });
    expect(scrubForRecord).not.toHaveBeenCalled();
  });

  it('marks a file failed when extraction throws, or yields no text', async () => {
    extractText.mockRejectedValueOnce(new Error('boom'));
    expect(await ingestWhatIfAttachment({ whatIfId, fileName: 'x.pdf', mimeType: 'application/pdf', bytes })).toMatchObject({ status: 'failed' });
    extractText.mockResolvedValueOnce({ status: 'low_text', text: '   ' });
    expect(await ingestWhatIfAttachment({ whatIfId, fileName: 'x.pdf', mimeType: 'application/pdf', bytes })).toMatchObject({ status: 'failed' });
  });

  it('records the vision cost when extraction reports one', async () => {
    extractText.mockResolvedValue({ status: 'ok', text: LONG, visionCostUsdCents: 42 });
    scrubForRecord.mockResolvedValue({ text: LONG, redactions: {} });
    await ingestWhatIfAttachment({ whatIfId, fileName: 'scan.pdf', mimeType: 'application/pdf', bytes });
    expect(recordSpend).toHaveBeenCalledWith(42);
  });
});

describe('attachmentsForAi', () => {
  const att = (fileName: string, status: string, extractedText: string | null) => ({ fileName, status, extractedText });

  it('gives text only for ok files', async () => {
    listWhatIfAttachments.mockResolvedValue([att('a', 'ok', 'hello'), att('b', 'held_back', null), att('c', 'failed', null)]);
    expect(await attachmentsForAi(whatIfId)).toEqual([
      { fileName: 'a', status: 'ok', text: 'hello', truncated: false },
      { fileName: 'b', status: 'held_back', text: null, truncated: false },
      { fileName: 'c', status: 'failed', text: null, truncated: false },
    ]);
  });

  it('stops at the text budget and says so', async () => {
    const first = 'x'.repeat(WHAT_IF_ATTACHMENT_TEXT_BUDGET - 10);
    listWhatIfAttachments.mockResolvedValue([att('a', 'ok', first), att('b', 'ok', 'y'.repeat(50)), att('c', 'ok', 'z')]);
    const out = await attachmentsForAi(whatIfId);
    expect(out[0]).toMatchObject({ text: first, truncated: false });
    expect(out[1]).toEqual({ fileName: 'b', status: 'ok', text: 'y'.repeat(10), truncated: true });
    expect(out[2]).toMatchObject({ text: null, truncated: true });
    expect(out.reduce((n, o) => n + (o.text?.length ?? 0), 0)).toBe(WHAT_IF_ATTACHMENT_TEXT_BUDGET);
  });
});

describe('isolation from the real course', () => {
  it('never touches the real course stores', () => {
    const src = readFileSync('lib/what-if/attachments.ts', 'utf8');
    for (const name of ['insertMaterial', 'supersedeOlderSyllabi', 'finalizeExtraction', 'enqueue', 'vector-store']) {
      expect(src).not.toContain(name);
    }
  });
});
