'use client';

import { useState } from 'react';
import { FACULTY_ROSTER } from '@/lib/faculty';

const ADD_NEW = '__add_new__';

/**
 * Instructor/auditor picker: the FACULTY_ROSTER dropdown plus a free-add path.
 * Picking "➕ Add a new name…" swaps in a text input so an instructor not on the
 * roster (guest, adjunct, new hire) can be entered. The typed name flows through
 * `onChange` exactly like a roster pick — it's used for this capture and stored
 * on the snapshot's `instructorName`; it is NOT persisted to the global roster
 * (use-now-only scope, 2026-06-16). A custom value shows as "<name> (new)" in
 * the dropdown so it stays visible if the user toggles back to the list.
 * Controlled by the parent (CaptureClient's chooserInstructor is the single
 * source of truth across the hero chooser, the materials step, and the
 * mid-session badge).
 */
export function InstructorSelect({
  id,
  value,
  onChange,
  className,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const cls = className ?? 'w-full rounded border border-input bg-background px-2 py-1.5 text-sm';
  const known = FACULTY_ROSTER.includes(value);

  if (adding) {
    return (
      <span className="flex items-center gap-1.5">
        <input
          type="text"
          autoFocus
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Type the instructor's name"
          aria-label="New instructor name"
          className={cls}
        />
        <button
          type="button"
          onClick={() => setAdding(false)}
          className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
          title="Choose from the list instead"
        >
          ↩ list
        </button>
      </span>
    );
  }

  return (
    <select
      id={id}
      value={value}
      onChange={e => {
        if (e.target.value === ADD_NEW) { onChange(''); setAdding(true); return; }
        onChange(e.target.value);
      }}
      className={cls}
    >
      {value === '' && <option value="" disabled>Instructor name</option>}
      {!known && value !== '' && <option value={value}>{value} (new)</option>}
      {FACULTY_ROSTER.map(name => (
        <option key={name} value={name}>{name}</option>
      ))}
      <option value={ADD_NEW}>➕ Add a new name…</option>
    </select>
  );
}
