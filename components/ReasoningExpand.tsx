'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FlagDialog } from './FlagDialog';

interface Props {
  reasoning: string;
  flagContext: string;          // human-readable description of what's being flagged
  onFlag: (note: string) => Promise<void>;
}

export function ReasoningExpand({ reasoning, flagContext, onFlag }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" onClick={() => setExpanded(v => !v)}>
        {expanded ? 'Hide why' : 'Why?'}
      </Button>
      {expanded && (
        <div className="rounded border border-border bg-muted/40 p-3 text-sm leading-relaxed">
          {reasoning}
          <div className="mt-2 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              Flag this
            </Button>
          </div>
        </div>
      )}
      <FlagDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={onFlag}
        context={flagContext}
      />
    </div>
  );
}
