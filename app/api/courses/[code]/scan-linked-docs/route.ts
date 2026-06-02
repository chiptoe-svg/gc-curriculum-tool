import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import {
  listMaterialsByCourse,
  insertMaterial,
} from '@/lib/db/course-materials-queries';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import { createVectorStore } from '@/lib/capture/vector-store';
import {
  extractGoogleWorkspaceReferences,
  type GoogleWorkspaceKind,
  type GoogleWorkspaceReference,
} from '@/lib/google-docs/extract-urls';
import { fetchGoogleFileText } from '@/lib/google-docs/fetch-doc';
import { extractYouTubeReferences } from '@/lib/youtube/extract-urls';
import { fetchYouTubeTranscript } from '@/lib/youtube/fetch-transcript';
import { transcribeYouTubeAudio } from '@/lib/youtube/transcribe-audio';
import { extractDriveFileReferences } from '@/lib/google-drive/extract-urls';
import { fetchDrivePdf } from '@/lib/google-drive/fetch-pdf';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

export const maxDuration = 60;

function fileNamePrefix(kind: GoogleWorkspaceKind): string {
  if (kind === 'document') return 'Google Doc';
  if (kind === 'presentation') return 'Google Slides';
  return 'Google Sheet';
}

// POST /api/courses/[code]/scan-linked-docs?slug=...
//
// Scans every existing material's extractedText for Google Workspace URLs
// (Docs and Slides today; Sheets and Drive files not yet supported),
// fetches each unique file via the public-export endpoint, and inserts a
// new course_materials row per fetched file. Files that aren't shared
// publicly are recorded with extractionStatus = 'failed' so faculty can
// see they were tried and flagged.
//
// Idempotent: skips files already represented by an existing material's
// blobUrl. Re-running picks up new references without duplicating.
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const vectorStore = createVectorStore();

  const materials = await listMaterialsByCourse(courseCode);

  // Collect every distinct (kind, fileId) referenced across the course's
  // materials. The map key is `${kind}:${fileId}` to avoid mixing types.
  const referenced = new Map<string, GoogleWorkspaceReference>();
  for (const m of materials) {
    if (!m.extractedText) continue;
    for (const ref of extractGoogleWorkspaceReferences(m.extractedText)) {
      referenced.set(`${ref.kind}:${ref.fileId}`, ref);
    }
  }

  // Skip files already represented via an existing material (by URL match
  // on blobUrl). Same kind+id pair must match — a doc and a slide can share
  // an opaque ID in theory, so type matters.
  const alreadyStored = new Set<string>();
  for (const m of materials) {
    if (!m.blobUrl) continue;
    for (const ref of extractGoogleWorkspaceReferences(m.blobUrl)) {
      alreadyStored.add(`${ref.kind}:${ref.fileId}`);
    }
  }

  const toFetch = [...referenced.entries()].filter(([key]) => !alreadyStored.has(key));

  const results: Array<{
    kind: GoogleWorkspaceKind;
    fileId: string;
    status: 'ok' | 'inaccessible';
    fileName?: string;
    errorReason?: string;
  }> = [];

  for (const [, ref] of toFetch) {
    const fetched = await fetchGoogleFileText(ref);
    const prefix = fileNamePrefix(ref.kind);
    if (fetched.status === 'ok') {
      const fileName = `${prefix}: ${fetched.title}`;
      const row = await insertMaterial({
        courseCode,
        fileName,
        blobUrl: ref.canonicalUrl,
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(fetched.text, 'utf8'),
        ipHash,
      });
      await finalizeExtraction({
        id: row.id,
        courseCode,
        fileName,
        extractionStatus: 'ok',
        extractionMethod: 'text',
        extractedText: fetched.text,
        vectorStore,
      });
      results.push({ kind: ref.kind, fileId: ref.fileId, status: 'ok', fileName });
    } else {
      const fileName = `${prefix}: ${ref.fileId.slice(0, 12)}… (not shared)`;
      const row = await insertMaterial({
        courseCode,
        fileName,
        blobUrl: ref.canonicalUrl,
        mimeType: 'text/plain',
        sizeBytes: 0,
        ipHash,
      });
      await finalizeExtraction({
        id: row.id,
        courseCode,
        fileName,
        extractionStatus: 'failed',
        extractionMethod: 'text',
        vectorStore,
      });
      results.push({ kind: ref.kind, fileId: ref.fileId, status: 'inaccessible', fileName, errorReason: fetched.errorReason });
    }
  }

  // YouTube transcripts — same auto-fetch pattern as the Google Workspace
  // files above. The audit gains visibility into linked lecture videos
  // wherever captions are available.
  const referencedYouTube = new Map<string, string>(); // videoId -> canonicalUrl
  for (const m of materials) {
    if (!m.extractedText) continue;
    for (const ref of extractYouTubeReferences(m.extractedText)) {
      if (!referencedYouTube.has(ref.videoId)) referencedYouTube.set(ref.videoId, ref.canonicalUrl);
    }
  }
  const alreadyStoredYouTube = new Set<string>();
  for (const m of materials) {
    if (!m.blobUrl) continue;
    for (const ref of extractYouTubeReferences(m.blobUrl)) {
      alreadyStoredYouTube.add(ref.videoId);
    }
  }
  const youtubeToFetch = [...referencedYouTube.entries()].filter(([id]) => !alreadyStoredYouTube.has(id));

  const youtubeResults: Array<{
    videoId: string;
    status: 'ok' | 'inaccessible';
    source?: 'captions' | 'whisper';
    fileName?: string;
    errorReason?: string;
  }> = [];

  for (const [videoId, canonicalUrl] of youtubeToFetch) {
    // First try captions (free, instant, English when available).
    let text: string | null = null;
    let source: 'captions' | 'whisper' = 'captions';
    let lastError: string | undefined;

    const captionsResult = await fetchYouTubeTranscript(videoId);
    if (captionsResult.status === 'ok') {
      text = captionsResult.text;
    } else {
      lastError = captionsResult.errorReason;
      // No captions (or only foreign-language captions that
      // youtube-transcript can't reach in English) → Whisper fallback.
      // Local whisper.cpp on the Mac, free + on-device.
      const whisper = await transcribeYouTubeAudio(videoId);
      if (whisper.status === 'ok' && whisper.text) {
        text = whisper.text;
        source = 'whisper';
      } else {
        lastError = whisper.errorReason ?? lastError;
      }
    }

    if (text !== null) {
      const titleGuess = text.slice(0, 80).trim() || videoId;
      const suffix = source === 'whisper' ? ' (Whisper)' : '';
      const fileName = `YouTube: ${titleGuess.slice(0, 60)}${titleGuess.length > 60 ? '…' : ''}${suffix}`;
      const row = await insertMaterial({
        courseCode,
        fileName,
        blobUrl: canonicalUrl,
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(text, 'utf8'),
        ipHash,
      });
      await finalizeExtraction({
        id: row.id,
        courseCode,
        fileName,
        extractionStatus: 'ok',
        extractionMethod: 'text',
        extractedText: text,
        vectorStore,
      });
      youtubeResults.push({ videoId, status: 'ok', source, fileName });
    } else {
      const fileName = `YouTube: ${videoId} (inaccessible)`;
      const row = await insertMaterial({
        courseCode,
        fileName,
        blobUrl: canonicalUrl,
        mimeType: 'text/plain',
        sizeBytes: 0,
        ipHash,
      });
      await finalizeExtraction({
        id: row.id,
        courseCode,
        fileName,
        extractionStatus: 'failed',
        extractionMethod: 'text',
        vectorStore,
      });
      youtubeResults.push({ videoId, status: 'inaccessible', fileName, errorReason: lastError });
    }
  }

  // Drive PDFs — same scan-then-fetch pattern as Workspace files and
  // YouTube. PDFs are downloaded, extracted, and stored as new materials.
  // Other Drive file types (DOCX, MP4, JPG, etc.) are recorded as
  // "unsupported" so the auditor knows a reference exists.
  const referencedDrive = new Map<string, string>(); // fileId -> canonicalUrl
  for (const m of materials) {
    if (!m.extractedText) continue;
    for (const ref of extractDriveFileReferences(m.extractedText)) {
      if (!referencedDrive.has(ref.fileId)) referencedDrive.set(ref.fileId, ref.canonicalUrl);
    }
  }
  const alreadyStoredDrive = new Set<string>();
  for (const m of materials) {
    if (!m.blobUrl) continue;
    for (const ref of extractDriveFileReferences(m.blobUrl)) {
      alreadyStoredDrive.add(ref.fileId);
    }
  }
  const driveToFetch = [...referencedDrive.entries()].filter(([id]) => !alreadyStoredDrive.has(id));

  const driveResults: Array<{
    fileId: string;
    status: 'ok' | 'unsupported' | 'inaccessible' | 'too_large';
    fileName?: string;
    errorReason?: string;
  }> = [];

  for (const [fileId, canonicalUrl] of driveToFetch) {
    const fetched = await fetchDrivePdf(fileId);
    if (fetched.status === 'ok' && fetched.text) {
      const fileName = `Drive PDF: ${fetched.title}`;
      const row = await insertMaterial({
        courseCode,
        fileName,
        blobUrl: canonicalUrl,
        mimeType: 'application/pdf',
        sizeBytes: Buffer.byteLength(fetched.text, 'utf8'),
        ipHash,
      });
      await finalizeExtraction({
        id: row.id,
        courseCode,
        fileName,
        extractionStatus: 'ok',
        extractionMethod: 'text',
        extractedText: fetched.text,
        vectorStore,
      });
      driveResults.push({ fileId, status: 'ok', fileName });
    } else {
      // Record the failed attempt so the materials panel surfaces what was
      // tried. Use a status-specific suffix so faculty can tell at a glance
      // whether it was a sharing issue, a type mismatch, or a size cap.
      const suffix =
        fetched.status === 'unsupported' ? '(unsupported type)'
        : fetched.status === 'too_large' ? '(too large)'
        : '(not accessible)';
      const fileName = `Drive PDF: ${fileId.slice(0, 12)}… ${suffix}`;
      const row = await insertMaterial({
        courseCode,
        fileName,
        blobUrl: canonicalUrl,
        mimeType: 'application/pdf',
        sizeBytes: 0,
        ipHash,
      });
      await finalizeExtraction({
        id: row.id,
        courseCode,
        fileName,
        extractionStatus: 'failed',
        extractionMethod: 'text',
        vectorStore,
      });
      driveResults.push({ fileId, status: fetched.status, fileName, errorReason: fetched.errorReason });
    }
  }

  const okCount = results.filter(r => r.status === 'ok').length;
  const failedCount = results.filter(r => r.status === 'inaccessible').length;
  const youtubeOk = youtubeResults.filter(r => r.status === 'ok').length;
  const youtubeInaccessible = youtubeResults.filter(r => r.status === 'inaccessible').length;
  const driveOk = driveResults.filter(r => r.status === 'ok').length;
  const driveInaccessible = driveResults.filter(r => r.status !== 'ok').length;
  const byKind = {
    documents: results.filter(r => r.kind === 'document').length,
    presentations: results.filter(r => r.kind === 'presentation').length,
    spreadsheets: results.filter(r => r.kind === 'spreadsheet').length,
    youtube_videos: youtubeOk,
    drive_pdfs: driveOk,
  };

  return NextResponse.json({
    referenced: [...referenced.values()].map(r => ({ kind: r.kind, fileId: r.fileId })),
    youtube_referenced: [...referencedYouTube.keys()],
    drive_referenced: [...referencedDrive.keys()],
    skipped: referenced.size - toFetch.length,
    youtube_skipped: referencedYouTube.size - youtubeToFetch.length,
    drive_skipped: referencedDrive.size - driveToFetch.length,
    fetched: okCount,
    inaccessible: failedCount,
    youtube_fetched: youtubeOk,
    youtube_inaccessible: youtubeInaccessible,
    drive_fetched: driveOk,
    drive_inaccessible: driveInaccessible,
    byKind,
    results,
    youtube_results: youtubeResults,
    drive_results: driveResults,
  });
}
