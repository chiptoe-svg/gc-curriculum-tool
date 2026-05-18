import { SignalHigh, SignalMedium, SignalLow } from 'lucide-react';
import type { CoverageScore } from '@/lib/domain/types';

type Confidence = CoverageScore['confidence'];

const ICON: Record<Confidence, typeof SignalHigh> = {
  high: SignalHigh,
  medium: SignalMedium,
  low: SignalLow,
};

const LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export function ConfidenceBars({ level, className = '' }: { level: Confidence; className?: string }) {
  const Icon = ICON[level];
  return (
    <Icon
      aria-label={LABEL[level]}
      className={`inline-block w-3.5 h-3.5 opacity-80 ${className}`}
    />
  );
}
