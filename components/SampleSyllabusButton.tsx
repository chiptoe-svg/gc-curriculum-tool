'use client';

import { Button } from '@/components/ui/button';
import { SAMPLE_SYLLABI } from '@/lib/domain/sample-syllabi';

interface Props {
  onLoad: (courseLabel: string, text: string) => void;
}

export function SampleSyllabusButton({ onLoad }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="text-xs text-muted-foreground self-center">Load example:</span>
      {SAMPLE_SYLLABI.map(s => (
        <Button
          key={s.courseCode}
          variant="outline"
          size="sm"
          type="button"
          onClick={() => onLoad(s.courseCode, s.syllabusText)}
        >
          {s.courseCode}
        </Button>
      ))}
    </div>
  );
}
