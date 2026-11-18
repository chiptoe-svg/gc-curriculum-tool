import { defaultAct } from '../compute';
import type { PointRow } from './types';

function numberOf(code: string): number {
  const m = /\d+/.exec(code);
  return m ? Number(m[0]) : 0;
}

/** Act, then course number, then develops before requires. Stable. */
export function orderPoints(points: PointRow[], levelOf: (code: string) => number): PointRow[] {
  const key = (p: PointRow) => [
    defaultAct({ code: p.courseCode, level: levelOf(p.courseCode) }),
    numberOf(p.courseCode),
    p.role === 'develops' ? 0 : 1,
  ];
  return [...points].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return (ka[i] ?? 0) - (kb[i] ?? 0);
    return 0;
  });
}
