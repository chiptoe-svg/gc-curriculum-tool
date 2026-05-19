'use client';

import { useState } from 'react';

export interface PositionFormValues {
  positionTitle: string;
  responsibilities: string;
  salaryRangeLow: number | null;
  salaryRangeHigh: number | null;
  salaryCurrency: string;
  interviewQuestions: string[];
  requiredSkills: string[];
  niceToHaveSkills: string[];
  additionalNotes: string;
}

interface Props {
  values: PositionFormValues;
  onChange: (v: PositionFormValues) => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  onBack: () => void;
  saving: boolean;
}

export function PositionForm({ values, onChange, onSaveDraft, onSubmit, onBack, saving }: Props) {
  const set = <K extends keyof PositionFormValues>(k: K, v: PositionFormValues[K]) =>
    onChange({ ...values, [k]: v });

  const canSubmit = values.positionTitle.trim().length > 0;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Describe the position</h1>
          <p className="mt-1 text-slate-600">Skip anything you don&apos;t want to answer. Only job title is required.</p>
        </div>
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={saving}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
      </div>

      <Section title="Position basics">
        <Field label="Job title *">
          <input type="text" value={values.positionTitle} onChange={e => set('positionTitle', e.target.value)}
                 className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
        </Field>
        <Field label="Responsibilities">
          <textarea value={values.responsibilities} onChange={e => set('responsibilities', e.target.value)} rows={4}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
        </Field>
      </Section>

      <Section title="Compensation (optional)">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Low">
            <input type="number" value={values.salaryRangeLow ?? ''}
                   onChange={e => set('salaryRangeLow', e.target.value === '' ? null : Number(e.target.value))}
                   className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </Field>
          <Field label="High">
            <input type="number" value={values.salaryRangeHigh ?? ''}
                   onChange={e => set('salaryRangeHigh', e.target.value === '' ? null : Number(e.target.value))}
                   className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </Field>
          <Field label="Currency">
            <select value={values.salaryCurrency} onChange={e => set('salaryCurrency', e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
              <option value="USD">USD</option>
              <option value="CAD">CAD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="What you look for">
        <Field label="Required skills">
          <TagsInput tags={values.requiredSkills} onChange={t => set('requiredSkills', t)}
                     placeholder="press to add — e.g., Color management" />
        </Field>
        <Field label="Nice-to-have skills">
          <TagsInput tags={values.niceToHaveSkills} onChange={t => set('niceToHaveSkills', t)}
                     placeholder="press to add" />
        </Field>
      </Section>

      <Section title="How you screen">
        <Field label="Interview questions you'd actually ask">
          <RepeatableTextRows
            rows={values.interviewQuestions}
            onChange={r => set('interviewQuestions', r)}
            placeholder="What's the question?"
            addLabel="+ add another"
          />
        </Field>
        <Field label="Anything else worth knowing">
          <textarea value={values.additionalNotes} onChange={e => set('additionalNotes', e.target.value)} rows={3}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
        </Field>
      </Section>

      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="text-sm text-slate-600 hover:underline">← Back</button>
        <div className="flex gap-2">
          <button type="button" onClick={onSaveDraft} disabled={saving}
                  className="rounded border border-slate-300 px-4 py-2 text-sm">Save draft</button>
          <button type="button" onClick={onSubmit} disabled={!canSubmit || saving}
                  className="rounded bg-slate-800 px-5 py-2 text-sm text-white disabled:opacity-50">
            {saving ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function TagsInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  function commit() {
    const t = draft.trim();
    if (!t) return;
    onChange([...tags, t]);
    setDraft('');
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {tags.map((t, i) => (
          <span key={`${t}-${i}`} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs">
            {t}
            <button type="button" onClick={() => onChange(tags.filter((_, j) => j !== i))} className="text-slate-500 hover:text-slate-800">×</button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        onBlur={commit}
        placeholder={placeholder}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />
    </div>
  );
}

function RepeatableTextRows({ rows, onChange, placeholder, addLabel }: {
  rows: string[]; onChange: (r: string[]) => void; placeholder?: string; addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <input
            type="text"
            value={r}
            onChange={e => onChange(rows.map((rr, j) => j === i ? e.target.value : rr))}
            placeholder={placeholder}
            className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  className="text-sm text-slate-500 hover:text-slate-800">remove</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, ''])} className="text-sm text-blue-700 hover:underline">
        {addLabel}
      </button>
    </div>
  );
}
