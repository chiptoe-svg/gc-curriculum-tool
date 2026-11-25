'use client';

import { useState } from 'react';

const CHOICES = ['arrives able', 'needs a refresher', 'learned here'] as const;

/**
 * Stage 4: one quick pick per skill the course assumes students bring. Sends one chat message, a line per
 * skill ("<skill>: <choice>"); typing an answer in the reply box works instead.
 */
export function IncomingSkillsCard({
  skills,
  onSubmit,
  disabled = false,
}: {
  skills: string[];
  onSubmit: (text: string) => void;
  disabled?: boolean;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const lines = skills.filter(s => picked[s]).map(s => `${s}: ${picked[s]}`);
  return (
    <div data-testid="incoming-skills-card" className="mt-4 rounded-xl border border-[#E4E2E8] bg-[#F7F5FA] px-4 py-3">
      <p className="cap-eyebrow">Skills students walk in with</p>
      <p className="mt-1 text-sm text-muted-foreground">
        For each skill, pick what happens in your course. Or just type your answer below.
      </p>
      <div className="mt-3 space-y-3">
        {skills.map(skill => (
          <fieldset key={skill} className="min-w-0">
            <legend className="text-sm font-medium text-[#1D1B22]">{skill}</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {CHOICES.map(choice => (
                <label key={choice} className="flex min-h-8 items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name={`incoming-${skill}`}
                    aria-label={`${skill}: ${choice}`}
                    checked={picked[skill] === choice}
                    onChange={() => setPicked(p => ({ ...p, [skill]: choice }))}
                  />
                  <span aria-hidden>{choice}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || lines.length === 0}
        onClick={() => onSubmit(lines.join('\n'))}
        className="cap-btn cap-btn-primary mt-3 min-h-9 text-sm"
      >
        Send these answers
      </button>
    </div>
  );
}
