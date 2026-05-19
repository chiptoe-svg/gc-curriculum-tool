'use client';

import { useState, useEffect } from 'react';
import { CareerTargetPicker, type TargetOption } from './CareerTargetPicker';
import { PositionForm, type PositionFormValues } from './PositionForm';
import { SubmissionConfirmation } from './SubmissionConfirmation';

interface Props {
  token: string;
  targets: TargetOption[];
  draftId: string | null;
}

type Step = 1 | 2 | 3;

const EMPTY: PositionFormValues = {
  positionTitle: '', responsibilities: '',
  salaryRangeLow: null, salaryRangeHigh: null, salaryCurrency: 'USD',
  interviewQuestions: [], requiredSkills: [], niceToHaveSkills: [],
  additionalNotes: '',
};

export function SubmissionWizard({ token, targets, draftId }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [unmapped, setUnmapped] = useState<string | null>(null);
  const [values, setValues] = useState<PositionFormValues>(EMPTY);
  const [submissionId, setSubmissionId] = useState<string | null>(draftId);
  const [saving, setSaving] = useState(false);
  const [submittedTitle, setSubmittedTitle] = useState('');

  // Hydrate draft if draftId passed in URL.
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      const res = await fetch(`/api/partners/submissions/${draftId}`);
      if (!res.ok) return;
      const { submission } = await res.json();
      setTargetId(submission.careerTargetId);
      setUnmapped(submission.unmappedTargetLabel);
      setValues({
        positionTitle: submission.positionTitle,
        responsibilities: submission.responsibilities,
        salaryRangeLow: submission.salaryRangeLow,
        salaryRangeHigh: submission.salaryRangeHigh,
        salaryCurrency: submission.salaryCurrency,
        interviewQuestions: submission.interviewQuestions ?? [],
        requiredSkills: submission.requiredSkills ?? [],
        niceToHaveSkills: submission.niceToHaveSkills ?? [],
        additionalNotes: submission.additionalNotes,
      });
      setStep(2);
    })();
  }, [draftId]);

  async function ensureDraft(): Promise<string> {
    if (submissionId) return submissionId;
    const res = await fetch('/api/partners/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        positionTitle: values.positionTitle || 'Untitled position',
        careerTargetId: targetId,
        unmappedTargetLabel: unmapped,
      }),
    });
    const { submission } = await res.json();
    setSubmissionId(submission.id);
    return submission.id;
  }

  async function saveDraft() {
    setSaving(true);
    try {
      const id = await ensureDraft();
      await fetch(`/api/partners/submissions/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...values, careerTargetId: targetId, unmappedTargetLabel: unmapped }),
      });
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    setSaving(true);
    try {
      const id = await ensureDraft();
      const patch = await fetch(`/api/partners/submissions/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...values, careerTargetId: targetId, unmappedTargetLabel: unmapped }),
      });
      if (!patch.ok) {
        alert('Save failed. Try again.');
        return;
      }
      const fin = await fetch(`/api/partners/submissions/${id}/submit`, { method: 'POST' });
      if (!fin.ok) {
        alert('Submit failed. Try again.');
        return;
      }
      setSubmittedTitle(values.positionTitle);
      setStep(3);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ProgressBar step={step} />
      {step === 1 && (
        <CareerTargetPicker
          targets={targets}
          selectedId={targetId}
          unmapped={unmapped}
          onPick={(id: string) => { setTargetId(id); setUnmapped(null); }}
          onUnmapped={(label: string) => { setUnmapped(label); setTargetId(null); }}
          onContinue={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <PositionForm
          values={values}
          onChange={setValues}
          onSaveDraft={saveDraft}
          onSubmit={submit}
          onBack={() => setStep(1)}
          saving={saving}
        />
      )}
      {step === 3 && (
        <SubmissionConfirmation
          title={submittedTitle}
          token={token}
          onAddAnother={() => {
            setStep(1);
            setTargetId(null);
            setUnmapped(null);
            setValues(EMPTY);
            setSubmissionId(null);
            setSubmittedTitle('');
          }}
        />
      )}
    </div>
  );
}

function ProgressBar({ step }: { step: Step }) {
  const labels = ['Choose closest match', 'Describe the position', 'Done'];
  return (
    <ol className="flex gap-2 text-xs">
      {labels.map((l, i) => {
        const idx = (i + 1) as Step;
        const done = step > idx, active = step === idx;
        return (
          <li key={l} className={`flex-1 rounded px-3 py-2 text-center ${
            active ? 'bg-slate-800 text-white' : done ? 'bg-slate-200' : 'bg-slate-50 text-slate-500'
          }`}>
            {idx}. {l}
          </li>
        );
      })}
    </ol>
  );
}
