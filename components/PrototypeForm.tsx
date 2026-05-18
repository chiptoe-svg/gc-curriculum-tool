'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SampleSyllabusButton } from './SampleSyllabusButton';
import { CAREER_TARGETS } from '@/lib/domain/seed-targets';

export interface AnalyzeInput {
  careerTargetId: string;
  upstream: { courseLabel: string; syllabusText: string };
  downstream: { courseLabel: string; syllabusText: string };
}

interface Props {
  onAnalyze: (input: AnalyzeInput) => void;
  isAnalyzing: boolean;
}

export function PrototypeForm({ onAnalyze, isAnalyzing }: Props) {
  const [careerTargetId, setCareerTargetId] = useState(CAREER_TARGETS[0]?.id ?? '');
  const [upstreamLabel, setUpstreamLabel] = useState('');
  const [upstreamText, setUpstreamText] = useState('');
  const [downstreamLabel, setDownstreamLabel] = useState('');
  const [downstreamText, setDownstreamText] = useState('');

  const canSubmit = upstreamText.length >= 50 && downstreamText.length >= 50 && !isAnalyzing;

  function handleSubmit() {
    onAnalyze({
      careerTargetId,
      upstream: { courseLabel: upstreamLabel, syllabusText: upstreamText },
      downstream: { courseLabel: downstreamLabel, syllabusText: downstreamText },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analyze two courses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="upstream-syllabus">Upstream course syllabus</Label>
          <SampleSyllabusButton onLoad={(code, text) => { setUpstreamLabel(code); setUpstreamText(text); }} />
          <Textarea
            id="upstream-syllabus"
            aria-label="Upstream course syllabus"
            placeholder="Paste the syllabus of the earlier course in the sequence..."
            rows={10}
            value={upstreamText}
            onChange={(e) => setUpstreamText(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="downstream-syllabus">Downstream course syllabus</Label>
          <SampleSyllabusButton onLoad={(code, text) => { setDownstreamLabel(code); setDownstreamText(text); }} />
          <Textarea
            id="downstream-syllabus"
            aria-label="Downstream course syllabus"
            placeholder="Paste the syllabus of the later course in the sequence..."
            rows={10}
            value={downstreamText}
            onChange={(e) => setDownstreamText(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="career-target">Career target</Label>
          <Select value={careerTargetId} onValueChange={(v) => { if (v !== null) setCareerTargetId(v); }}>
            <SelectTrigger id="career-target" aria-label="Career target">
              <SelectValue placeholder="Choose a target" />
            </SelectTrigger>
            <SelectContent>
              {CAREER_TARGETS.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button size="lg" onClick={handleSubmit} disabled={!canSubmit}>
          {isAnalyzing ? 'Analyzing…' : 'Analyze'}
        </Button>
      </CardContent>
    </Card>
  );
}
