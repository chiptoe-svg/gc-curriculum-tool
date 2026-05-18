'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (note: string) => Promise<void>;
  context: string;
}

export function FlagDialog({ open, onOpenChange, onSubmit, context }: Props) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (note.trim().length === 0) return;
    setSubmitting(true);
    try {
      await onSubmit(note);
      setNote('');
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Flag this AI reasoning</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{context}</p>
        <Textarea
          placeholder="What is specifically wrong with the AI's reasoning? (Faculty pushback gets used to tune prompts.)"
          rows={5}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || note.trim().length === 0}>
            {submitting ? 'Saving…' : 'Submit flag'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
