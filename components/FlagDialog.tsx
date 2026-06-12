'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { FACULTY_ROSTER, DEPARTMENT_CANONICAL } from '@/lib/faculty';

const FLAGGER_KEY = 'gc-flagger-name';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** note + the roster name the flag is filed under */
  onSubmit: (note: string, flaggedBy: string) => Promise<void>;
  context: string;
}

export function FlagDialog({ open, onOpenChange, onSubmit, context }: Props) {
  const [note, setNote] = useState('');
  const [name, setName] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(FLAGGER_KEY) ?? '';
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (note.trim().length === 0 || name.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(note.trim(), name);
      localStorage.setItem(FLAGGER_KEY, name);
      setNote('');
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to file flag');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Flag this AI reading</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{context}</p>
        <label htmlFor="flag-dialog-name" className="block text-xs text-muted-foreground">
          Flagging as
          <select
            id="flag-dialog-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="" disabled>Select your name…</option>
            {FACULTY_ROSTER.filter(n => n !== DEPARTMENT_CANONICAL).map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <Textarea
          placeholder="What is specifically wrong with this reading? Flags stay open until someone resolves them with a note."
          rows={5}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && <p className="text-xs text-amber-700">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || note.trim().length === 0 || name.length === 0}>
            {submitting ? 'Saving…' : 'Submit flag'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
