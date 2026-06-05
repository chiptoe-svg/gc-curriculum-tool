'use client';

/**
 * Page3Section — Interview Questions + optional interview guide upload.
 *
 * structuredInputs keys written here:
 *   structuredInputs.interview_questions — string | null  (textarea)
 *   structuredInputs.interview_doc_text  — written server-side by /upload-doc route
 *
 * The upload-doc route also appends to sourceFiles[] on the row.
 * On success the client shows a small "uploaded ✓ (filename)" badge.
 */

import { useRef, useState } from 'react';
import { VoiceRecorder } from '@/components/VoiceRecorder';

interface Patch {
  structuredInputs?: Record<string, unknown>;
}

interface Props {
  token: string;
  captureId: string;
  structuredInputs: Record<string, unknown>;
  positionTitle: string | null;
  onChange: (patch: Patch) => void;
}

export function Page3Section({ token, captureId, structuredInputs, onChange }: Props) {
  const [interviewQuestions, setInterviewQuestions] = useState<string>(
    typeof structuredInputs.interview_questions === 'string' ? structuredInputs.interview_questions : '',
  );

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const transcribeEndpoint = `/api/partners/transcribe?token=${encodeURIComponent(token)}`;

  function emitQuestions(val: string) {
    setInterviewQuestions(val);
    onChange({ structuredInputs: { ...structuredInputs, interview_questions: val || null } });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(
        `/api/partners/${encodeURIComponent(token)}/positions/${encodeURIComponent(captureId)}/upload-doc`,
        { method: 'POST', body: fd },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setUploadError(j.error ?? `Upload failed (${res.status})`);
        return;
      }
      const { fileName } = await res.json() as { ok: boolean; fileName: string; textLength: number };
      setUploadedFileName(fileName);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-4">
        <h2 className="mb-1 text-base font-semibold text-slate-800">Key interview questions</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          What questions do you typically ask candidates for this role? What do those questions reveal about
          a candidate's readiness?
        </p>
        <textarea
          value={interviewQuestions}
          onChange={e => emitQuestions(e.target.value)}
          rows={7}
          placeholder="e.g., Walk me through a project from brief to delivery. How do you handle a last-minute change from the client the day before production? What's your workflow for preflighting files?"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400"
        />
        <div className="mt-2">
          <VoiceRecorder
            endpoint={transcribeEndpoint}
            onTranscript={text => emitQuestions((interviewQuestions + ' ' + text).trim())}
          />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-4">
        <h2 className="mb-1 text-base font-semibold text-slate-800">Interview rubric or guide (optional)</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          If you have a scoring rubric, interview guide, or evaluation sheet for this role, upload it here.
          The text will be extracted and included in the profile analysis.
        </p>

        {/* Upload button */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="sr-only"
          onChange={handleFileChange}
          disabled={uploading}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Upload rubric / guide (PDF, DOCX, TXT)'}
        </button>

        {uploadedFileName && !uploading && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700">
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Uploaded: {uploadedFileName}
          </p>
        )}

        {uploadError && (
          <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {uploadError}
          </p>
        )}
      </section>
    </div>
  );
}
