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
  courseLabel: string;
  gaps: PrerequisiteGap[];
  onFlag: (target: string, note: string) => Promise<void>;
}

export function PrerequisiteGapPanel({ target, courseLabel, gaps, onFlag }: Props) {
  const nameOf = (id: string) => target.subCompetencies.find(s => s.id === id)?.name ?? id;

  const met = gaps.filter(g => g.status === 'met').length;
  const under = gaps.filter(g => g.status === 'underdeveloped').length;
  const missing = gaps.filter(g => g.status === 'missing').length;
  const total = gaps.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>How well does the prior coursework prepare students for <em>{courseLabel || 'this course'}</em>?</CardTitle>
        {total > 0 && (
          <p className="text-sm text-muted-foreground leading-relaxed pt-2">
            Of the {total} competenc{total === 1 ? 'y' : 'ies'} this course expects students to walk in with:{' '}
            <strong className="text-foreground">{met} met</strong>
            {under > 0 && <>, <strong className="text-foreground">{under} underdeveloped</strong></>}
            {missing > 0 && <>, <strong className="text-foreground">{missing} missing</strong></>}.
          </p>
        )}
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
            <p className="text-sm"><strong>What prior coursework actually does:</strong> {g.priorCourseworkEvidence}</p>
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
