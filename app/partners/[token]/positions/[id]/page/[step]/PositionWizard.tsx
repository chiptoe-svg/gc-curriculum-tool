'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Page1Section } from './Page1Section';
import { Page2Section } from './Page2Section';
import { Page3Section } from './Page3Section';
import { Page4Section } from './Page4Section';
import { Page5Section, type RatedSkillsValue } from './Page5Section';
import { Page6Section } from './Page6Section';

interface CaptureSnapshot {
  id: string;
  positionTitle: string | null;
  company: string;
  structuredInputs: Record<string, unknown>;
  ratedSkills: RatedSkillsValue | null;
  sessionId: string | null;
}

interface Props {
  token: string;
  step: 1 | 2 | 3 | 4 | 5 | 6;
  capture: CaptureSnapshot;
  target: { id: string; name: string; shortDefinition: string };
}

export function PositionWizard({ token, step, capture, target }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<CaptureSnapshot>(capture);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Step-5 min-5-ratings gate: starts valid only if coming back to a previously saved page with ≥5 rated items
  const [step5Valid, setStep5Valid] = useState<boolean>(
    () => (capture.ratedSkills?.items.filter(it => typeof it.rating === 'number').length ?? 0) >= 5,
  );

  async function saveAndGo(next: number | 'done', completeness?: 'title-only' | 'structured' | 'rated') {
    setError(null);
    startSave(async () => {
      const res = await fetch(`/api/partners/${encodeURIComponent(token)}/positions/${draft.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          positionTitle: draft.positionTitle,
          structuredInputs: draft.structuredInputs,
          ratedSkills: draft.ratedSkills,
          ...(completeness && { completeness }),
        }),
      });
      if (!res.ok) {
        setError('save failed');
        return;
      }
      if (next === 'done') {
        router.push(`/partners/${encodeURIComponent(token)}`);
      } else {
        router.push(`/partners/${encodeURIComponent(token)}/positions/${draft.id}/page/${next}`);
      }
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Position Capture · {target.name}</p>
        <h1 className="mt-1 text-2xl font-semibold">{draft.positionTitle || '(new position)'}</h1>
      </header>

      <Steps step={step} />

      {step === 1 && (
        <Page1Section
          token={token}
          captureId={draft.id}
          structuredInputs={draft.structuredInputs}
          positionTitle={draft.positionTitle}
          onChange={(patch) => setDraft(d => ({ ...d, ...patch }))}
        />
      )}
      {step === 2 && (
        <Page2Section
          token={token}
          captureId={draft.id}
          structuredInputs={draft.structuredInputs}
          positionTitle={draft.positionTitle}
          onChange={(patch) => setDraft(d => ({ ...d, ...patch }))}
        />
      )}
      {step === 3 && (
        <Page3Section
          token={token}
          captureId={draft.id}
          structuredInputs={draft.structuredInputs}
          positionTitle={draft.positionTitle}
          onChange={(patch) => setDraft(d => ({ ...d, ...patch }))}
        />
      )}
      {step === 4 && (
        <Page4Section
          token={token}
          captureId={draft.id}
          structuredInputs={draft.structuredInputs}
          positionTitle={draft.positionTitle}
          onChange={(patch) => setDraft(d => ({ ...d, ...patch }))}
        />
      )}
      {step === 5 && (
        <Page5Section
          token={token}
          captureId={draft.id}
          structuredInputs={draft.structuredInputs}
          positionTitle={draft.positionTitle}
          ratedSkills={draft.ratedSkills}
          onChange={(patch) => setDraft(d => ({ ...d, ...patch }))}
          onValidityChange={setStep5Valid}
        />
      )}
      {step === 6 && (
        <Page6Section
          token={token}
          captureId={draft.id}
          positionTitle={draft.positionTitle}
        />
      )}

      <nav className="mt-6 flex items-center justify-between">
        <button
          type="button"
          disabled={step === 1 || saving}
          onClick={() => saveAndGo(step - 1)}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          ← Back
        </button>
        <div className="flex gap-2">
          {step < 6 && (
            <button
              type="button"
              disabled={saving || !draft.positionTitle}
              onClick={() => saveAndGo('done', step === 1 ? 'title-only' : step <= 4 ? 'structured' : 'rated')}
              className="rounded-md border px-3 py-1.5 text-sm font-medium"
            >
              Save &amp; finish later
            </button>
          )}
          {step < 6 && (
            <button
              type="button"
              disabled={
                saving ||
                (step === 1 && !draft.positionTitle) ||
                (step === 5 && !step5Valid)
              }
              onClick={() => saveAndGo(step + 1, step === 5 ? 'rated' : undefined)}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Next →
            </button>
          )}
        </div>
      </nav>

      {error && (
        <p className="mt-3 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800">{error}</p>
      )}
    </div>
  );
}

function Steps({ step }: { step: number }) {
  const labels = ['Job description', 'Uniqueness', 'Interview Qs', 'Trajectory', 'Rate experiences', 'Interview'];
  return (
    <ol className="mb-6 flex items-center gap-2 text-xs">
      {labels.map((l, i) => {
        const n = i + 1;
        const state = n === step ? 'active' : n < step ? 'done' : 'pending';
        return (
          <li
            key={l}
            className={
              state === 'active' ? 'rounded bg-slate-900 px-2 py-1 font-medium text-white'
                : state === 'done' ? 'rounded bg-slate-200 px-2 py-1 text-slate-600'
                : 'rounded border border-dashed border-slate-300 px-2 py-1 text-slate-500'
            }
          >
            {n}. {l}
          </li>
        );
      })}
    </ol>
  );
}
