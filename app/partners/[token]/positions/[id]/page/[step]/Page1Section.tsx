'use client';

/**
 * Page1Section — JD ingest + structured field review.
 *
 * structuredInputs shape used here (also the contract for Tasks 14-16 extending it):
 *
 *   structuredInputs.jd_fields = {
 *     title:                    { value: string | null, confidence: number },
 *     responsibilities:         { value: string | null, confidence: number },
 *     required_qualifications:  { value: string | null, confidence: number },
 *     preferred_qualifications: { value: string | null, confidence: number },
 *     years_experience:         { value: { min: number, max: number | null } | null, confidence: number },
 *     education:                { value: string | null, confidence: number },
 *     location:                 { value: string | null, confidence: number },
 *     remote_status:            { value: 'onsite'|'remote'|'hybrid' | null, confidence: number },
 *     salary_range:             { value: { min: number, max: number, currency: string } | null, confidence: number },
 *     reports_to:               { value: string | null, confidence: number },
 *     extras_notes:             { value: string | null, confidence: number },
 *   }
 *
 *   positionTitle (top-level on the draft row) is kept in sync with jd_fields.title.value
 *   whenever the user edits the title field here.
 *
 * Pages 2-4 write into structuredInputs.uniqueness, .success_criteria, .interview_doc_text,
 * .trajectory_freeform — they don't touch jd_fields.
 */

import { useRef, useState } from 'react';
import { VoiceRecorder } from '@/components/VoiceRecorder';

// ---- Types ----------------------------------------------------------------

interface ConfidenceField<T> {
  value: T | null;
  confidence: number;
}

interface YearsExperienceValue { min: number; max: number | null }
interface SalaryRangeValue { min: number; max: number; currency: string }

interface JdFields {
  title: ConfidenceField<string>;
  responsibilities: ConfidenceField<string>;
  required_qualifications: ConfidenceField<string>;
  preferred_qualifications: ConfidenceField<string>;
  years_experience: ConfidenceField<YearsExperienceValue>;
  education: ConfidenceField<string>;
  location: ConfidenceField<string>;
  remote_status: ConfidenceField<'onsite' | 'remote' | 'hybrid'>;
  salary_range: ConfidenceField<SalaryRangeValue>;
  reports_to: ConfidenceField<string>;
  extras_notes: ConfidenceField<string>;
}

interface Patch {
  positionTitle?: string | null;
  structuredInputs?: Record<string, unknown>;
}

interface Props {
  token: string;
  captureId: string;
  structuredInputs: Record<string, unknown>;
  positionTitle: string | null;
  onChange: (patch: Patch) => void;
}

// ---- Helpers ---------------------------------------------------------------

function emptyField<T>(): ConfidenceField<T> {
  return { value: null, confidence: 0 };
}

function defaultJdFields(): JdFields {
  return {
    title: emptyField<string>(),
    responsibilities: emptyField<string>(),
    required_qualifications: emptyField<string>(),
    preferred_qualifications: emptyField<string>(),
    years_experience: emptyField<YearsExperienceValue>(),
    education: emptyField<string>(),
    location: emptyField<string>(),
    remote_status: emptyField<'onsite' | 'remote' | 'hybrid'>(),
    salary_range: emptyField<SalaryRangeValue>(),
    reports_to: emptyField<string>(),
    extras_notes: emptyField<string>(),
  };
}

function parseJdFields(raw: unknown): JdFields {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as JdFields;
  }
  return defaultJdFields();
}

/** Confidence dot: green ≥0.9, yellow 0.6-0.9, red <0.6, gray for empty/zero */
function ConfidenceDot({ confidence, hasValue }: { confidence: number; hasValue: boolean }) {
  if (!hasValue || confidence === 0) {
    return (
      <span
        title="No value extracted"
        className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300"
        aria-label="empty"
      />
    );
  }
  const color = confidence >= 0.9
    ? 'bg-emerald-500'
    : confidence >= 0.6
    ? 'bg-amber-400'
    : 'bg-red-500';
  const label = confidence >= 0.9 ? 'high confidence' : confidence >= 0.6 ? 'medium confidence' : 'low confidence';
  return (
    <span
      title={`${label} (${Math.round(confidence * 100)}%)`}
      className={`inline-block h-2.5 w-2.5 rounded-full ${color}`}
      aria-label={label}
    />
  );
}

/** Small "needs review" badge for empty or low-confidence fields */
function NeedsReviewBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
      needs review
    </span>
  );
}

function needsReview(f: ConfidenceField<unknown>): boolean {
  return f.value === null || f.confidence < 0.6;
}

// ---- Component ------------------------------------------------------------

export function Page1Section({ token, captureId, structuredInputs, positionTitle, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize fields from structuredInputs.jd_fields if present, else empty
  const initialFields = parseJdFields((structuredInputs as Record<string, unknown>).jd_fields);
  const [fields, setFields] = useState<JdFields>(initialFields);

  // Track whether we've done an extraction pass yet
  const [extracted, setExtracted] = useState(
    initialFields.title.confidence > 0 || initialFields.title.value !== null,
  );

  // Paste textarea
  const [pasteText, setPasteText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  // ---- notify parent ----
  function emit(updated: JdFields, titleOverride?: string | null) {
    const title = titleOverride !== undefined ? titleOverride : (updated.title.value ?? null);
    onChange({
      positionTitle: title,
      structuredInputs: { ...structuredInputs, jd_fields: updated },
    });
  }

  // ---- field-level update ----
  function updateStringField(
    key: keyof Pick<JdFields, 'title' | 'responsibilities' | 'required_qualifications' | 'preferred_qualifications' | 'education' | 'location' | 'reports_to' | 'extras_notes'>,
    val: string,
  ) {
    setFields(prev => {
      const next: JdFields = {
        ...prev,
        [key]: { value: val || null, confidence: prev[key].confidence || 1 },
      };
      emit(next);
      return next;
    });
  }

  // ---- extract ----
  async function doExtract(body: FormData | string) {
    setExtracting(true);
    setExtractError(null);
    try {
      const isText = typeof body === 'string';
      const res = await fetch(
        `/api/partners/${encodeURIComponent(token)}/positions/${encodeURIComponent(captureId)}/extract-jd`,
        isText
          ? {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ text: body }),
            }
          : { method: 'POST', body },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setExtractError(j.error ?? `Extraction failed (${res.status})`);
        return;
      }
      const { fields: returned } = await res.json() as { fields: JdFields };
      setFields(returned);
      setExtracted(true);
      emit(returned);
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setExtracting(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    void doExtract(fd);
    // Reset so re-uploading same file triggers onChange again
    e.target.value = '';
  }

  function handleParse() {
    if (!pasteText.trim()) return;
    void doExtract(pasteText.trim());
  }

  // ---- render helpers ----
  function FieldLabel({ label, required, field }: { label: string; required?: boolean; field: ConfidenceField<unknown> }) {
    return (
      <div className="flex items-center gap-2">
        <ConfidenceDot confidence={field.confidence} hasValue={field.value !== null} />
        <span className="text-sm font-medium text-slate-700">
          {label}
          {required && <span className="ml-0.5 text-red-600" aria-label="required">*</span>}
        </span>
        {needsReview(field) && <NeedsReviewBadge />}
      </div>
    );
  }

  const transcribeEndpoint = `/api/partners/transcribe?token=${encodeURIComponent(token)}`;

  return (
    <div className="space-y-6">
      {/* --- JD ingest zone --- */}
      {!extracted && (
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <h2 className="mb-3 text-base font-semibold text-slate-800">Add a job description</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Upload a PDF or Word document, or paste the text below. The AI will extract key fields — you'll
            review and edit them on this page.
          </p>

          {/* File upload */}
          <div className="mb-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="sr-only"
              onChange={handleFileChange}
              disabled={extracting}
            />
            <button
              type="button"
              disabled={extracting}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {extracting ? 'Extracting…' : 'Upload JD (PDF / DOCX / TXT)'}
            </button>
          </div>

          <div className="mb-2 flex items-center gap-3 text-xs text-slate-400">
            <div className="flex-1 border-t border-slate-300" />
            or paste below
            <div className="flex-1 border-t border-slate-300" />
          </div>

          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={6}
            disabled={extracting}
            placeholder="Paste job description text here…"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 disabled:opacity-50"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={extracting || !pasteText.trim()}
              onClick={handleParse}
              className="rounded-md bg-slate-800 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {extracting ? 'Parsing…' : 'Parse'}
            </button>
          </div>

          {extractError && (
            <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {extractError}
            </p>
          )}
        </section>
      )}

      {/* Re-extract option once fields are populated */}
      {extracted && (
        <div className="flex items-center justify-between rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5">
          <span className="text-sm text-slate-600">Fields extracted from JD. Edit freely below.</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={extracting}
              onClick={() => fileInputRef.current?.click()}
              className="text-sm text-blue-700 hover:underline disabled:opacity-50"
            >
              Re-upload JD
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="sr-only"
              onChange={handleFileChange}
              disabled={extracting}
            />
          </div>
        </div>
      )}

      {/* --- Editable fields (always visible after first extraction OR for manual entry) --- */}
      {(extracted || true) && (
        <div className="space-y-5">
          {/* Job Title — REQUIRED */}
          <div className="space-y-1">
            <FieldLabel label="Job title" required field={fields.title} />
            <input
              type="text"
              value={fields.title.value ?? ''}
              onChange={e => updateStringField('title', e.target.value)}
              placeholder="e.g., Packaging Design Engineer"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {/* Responsibilities */}
          <div className="space-y-1">
            <FieldLabel label="Responsibilities" field={fields.responsibilities} />
            <textarea
              value={fields.responsibilities.value ?? ''}
              onChange={e => updateStringField('responsibilities', e.target.value)}
              rows={5}
              placeholder="Key duties and day-to-day responsibilities…"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="pt-1">
              <VoiceRecorder
                endpoint={transcribeEndpoint}
                onTranscript={text => updateStringField('responsibilities', ((fields.responsibilities.value ?? '') + ' ' + text).trim())}
              />
            </div>
          </div>

          {/* Required qualifications */}
          <div className="space-y-1">
            <FieldLabel label="Required qualifications" field={fields.required_qualifications} />
            <textarea
              value={fields.required_qualifications.value ?? ''}
              onChange={e => updateStringField('required_qualifications', e.target.value)}
              rows={4}
              placeholder="Must-have skills and experience…"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {/* Preferred qualifications */}
          <div className="space-y-1">
            <FieldLabel label="Preferred qualifications" field={fields.preferred_qualifications} />
            <textarea
              value={fields.preferred_qualifications.value ?? ''}
              onChange={e => updateStringField('preferred_qualifications', e.target.value)}
              rows={3}
              placeholder="Nice-to-have skills…"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {/* Years experience */}
          <div className="space-y-1">
            <FieldLabel label="Years of experience" field={fields.years_experience} />
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={50}
                value={fields.years_experience.value?.min ?? ''}
                onChange={e => {
                  const min = parseInt(e.target.value, 10);
                  setFields(prev => {
                    const next: JdFields = {
                      ...prev,
                      years_experience: {
                        value: isNaN(min) ? null : { min, max: prev.years_experience.value?.max ?? null },
                        confidence: prev.years_experience.confidence || 1,
                      },
                    };
                    emit(next);
                    return next;
                  });
                }}
                placeholder="min"
                className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <span className="text-sm text-slate-500">to</span>
              <input
                type="number"
                min={0}
                max={50}
                value={fields.years_experience.value?.max ?? ''}
                onChange={e => {
                  const max = parseInt(e.target.value, 10);
                  setFields(prev => {
                    const next: JdFields = {
                      ...prev,
                      years_experience: {
                        value: {
                          min: prev.years_experience.value?.min ?? 0,
                          max: isNaN(max) ? null : max,
                        },
                        confidence: prev.years_experience.confidence || 1,
                      },
                    };
                    emit(next);
                    return next;
                  });
                }}
                placeholder="max (opt)"
                className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <span className="text-sm text-slate-500">years</span>
            </div>
          </div>

          {/* Education */}
          <div className="space-y-1">
            <FieldLabel label="Education requirement" field={fields.education} />
            <input
              type="text"
              value={fields.education.value ?? ''}
              onChange={e => updateStringField('education', e.target.value)}
              placeholder="e.g., Bachelor's in Graphic Communications or related field"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {/* Location */}
          <div className="space-y-1">
            <FieldLabel label="Location" field={fields.location} />
            <input
              type="text"
              value={fields.location.value ?? ''}
              onChange={e => updateStringField('location', e.target.value)}
              placeholder="e.g., Greenville, SC"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {/* Remote status */}
          <div className="space-y-1">
            <FieldLabel label="Remote status" field={fields.remote_status} />
            <select
              value={fields.remote_status.value ?? ''}
              onChange={e => {
                const v = e.target.value as 'onsite' | 'remote' | 'hybrid' | '';
                setFields(prev => {
                  const next: JdFields = {
                    ...prev,
                    remote_status: { value: v || null, confidence: prev.remote_status.confidence || 1 },
                  };
                  emit(next);
                  return next;
                });
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— not specified —</option>
              <option value="onsite">On-site</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>

          {/* Salary range */}
          <div className="space-y-1">
            <FieldLabel label="Salary range" field={fields.salary_range} />
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={fields.salary_range.value?.min ?? ''}
                onChange={e => {
                  const min = parseFloat(e.target.value);
                  setFields(prev => {
                    const next: JdFields = {
                      ...prev,
                      salary_range: {
                        value: isNaN(min) ? null : {
                          min,
                          max: prev.salary_range.value?.max ?? 0,
                          currency: prev.salary_range.value?.currency ?? 'USD',
                        },
                        confidence: prev.salary_range.confidence || 1,
                      },
                    };
                    emit(next);
                    return next;
                  });
                }}
                placeholder="min"
                className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <span className="text-sm text-slate-500">to</span>
              <input
                type="number"
                value={fields.salary_range.value?.max ?? ''}
                onChange={e => {
                  const max = parseFloat(e.target.value);
                  setFields(prev => {
                    const next: JdFields = {
                      ...prev,
                      salary_range: {
                        value: {
                          min: prev.salary_range.value?.min ?? 0,
                          max: isNaN(max) ? 0 : max,
                          currency: prev.salary_range.value?.currency ?? 'USD',
                        },
                        confidence: prev.salary_range.confidence || 1,
                      },
                    };
                    emit(next);
                    return next;
                  });
                }}
                placeholder="max"
                className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <input
                type="text"
                value={fields.salary_range.value?.currency ?? 'USD'}
                maxLength={10}
                onChange={e => {
                  const currency = e.target.value;
                  setFields(prev => {
                    const next: JdFields = {
                      ...prev,
                      salary_range: {
                        value: prev.salary_range.value
                          ? { ...prev.salary_range.value, currency }
                          : null,
                        confidence: prev.salary_range.confidence,
                      },
                    };
                    emit(next);
                    return next;
                  });
                }}
                placeholder="USD"
                className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-sm uppercase"
              />
            </div>
          </div>

          {/* Reports to */}
          <div className="space-y-1">
            <FieldLabel label="Reports to" field={fields.reports_to} />
            <input
              type="text"
              value={fields.reports_to.value ?? ''}
              onChange={e => updateStringField('reports_to', e.target.value)}
              placeholder="e.g., Director of Product Development"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {/* Extras / notes */}
          <div className="space-y-1">
            <FieldLabel label="Extras / notes" field={fields.extras_notes} />
            <p className="text-xs text-muted-foreground">
              Anything the JD mentions that didn&apos;t fit the fields above — culture notes, tools, perks, etc.
            </p>
            <textarea
              value={fields.extras_notes.value ?? ''}
              onChange={e => updateStringField('extras_notes', e.target.value)}
              rows={4}
              placeholder="Additional context, tools mentioned, culture notes…"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="pt-1">
              <VoiceRecorder
                endpoint={transcribeEndpoint}
                onTranscript={text => updateStringField('extras_notes', ((fields.extras_notes.value ?? '') + ' ' + text).trim())}
              />
            </div>
          </div>
        </div>
      )}

      {extracting && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Extracting fields from JD…
        </div>
      )}
    </div>
  );
}
