import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { KUDOutcomes } from '@/lib/domain/types';

interface Props {
  courseLabel: string;
  kud: KUDOutcomes;
}

export function KUDCard({ courseLabel, kud }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{courseLabel}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Threshold concept</p>
          <p className="mt-1 italic">{kud.description}</p>
        </div>
        <Section title="Know" items={kud.know} />
        <Section title="Understand" items={kud.understand} />
        <Section title="Do" items={kud.do} />
      </CardContent>
    </Card>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="mt-1 list-disc pl-5 space-y-1">
        {items.map((it, i) => <li key={i} className="text-sm">{it}</li>)}
      </ul>
    </div>
  );
}
