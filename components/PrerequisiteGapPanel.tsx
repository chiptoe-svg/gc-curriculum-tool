'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ReasoningExpand } from './ReasoningExpand';
import type { CareerTarget, PrerequisiteGap, GapStatus } from '@/lib/domain/types';

const STATUS_COLOR: Record<GapStatus, string> = {
  met: 'bg-emerald-700 text-white',
  underdeveloped: 'bg-amber-500 text-black',
  missing: 'bg-red-700 text-white',
};

const STATUS_LABEL: Record<GapStatus, string> = {
  met: 'Met',
  underdeveloped: 'Underdeveloped',
  missing: 'Missing',
};

interface Props {
  target: CareerTarget;
  gaps: PrerequisiteGap[];
  onFlag: (target: string, note: string) => Promise<void>;
}

export function PrerequisiteGapPanel({ target, gaps, onFlag }: Props) {
  const nameOf = (id: string) => target.subCompetencies.find(s => s.id === id)?.name ?? id;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prerequisite gap analysis</CardTitle>
        <p className="text-sm text-muted-foreground">
          What the downstream course expects students to walk in with, and whether the upstream course actually develops it.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {gaps.length === 0 && <p className="text-sm text-muted-foreground italic">No prerequisite competencies were identified.</p>}
        {gaps.map((g, i) => (
          <div key={i} className="border border-border rounded p-4 space-y-2">
            <div className="flex justify-between items-baseline gap-4">
              <div>
                <p className="font-medium">{nameOf(g.subCompetencyId)}</p>
                <p className="text-xs text-muted-foreground">Expected at: <strong>{g.expectedKudLevel}</strong></p>
              </div>
              <Badge className={STATUS_COLOR[g.status]}>{STATUS_LABEL[g.status]}</Badge>
            </div>
            <p className="text-sm"><strong>What upstream actually does:</strong> {g.upstreamEvidence}</p>
            <ReasoningExpand
              reasoning={g.reasoning}
              flagContext={`Prereq gap • ${nameOf(g.subCompetencyId)} • ${STATUS_LABEL[g.status]}`}
              onFlag={(note) => onFlag(`gap.${g.subCompetencyId}`, note)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
