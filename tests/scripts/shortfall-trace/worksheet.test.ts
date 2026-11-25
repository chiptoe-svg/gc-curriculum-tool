import { describe, it, expect } from 'vitest';
import { parseCsv, readRequired, readLinks } from '@/scripts/analysis/shortfall-trace/worksheet';

const comps = [
  { id: 'color-management', name: 'Color management', foundational: false },
  { id: 'attention-to-detail', name: 'Attention to detail', foundational: true },
];
const courses = ['GC 1040', 'GC 2070'];

describe('parseCsv', () => {
  it('handles quoted commas, doubled quotes, embedded newlines and CRLF', () => {
    const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n,,\r\n');
    expect(rows).toEqual([['a', 'b', 'c'], ['x, y', 'say "hi"', 'line1\nline2'], ['', '', '']]);
  });
});

describe('readRequired', () => {
  const head = 'Competency,Weight for this target,Foundational?,Best depth on the path today (reference),Required K,Required U,Required D,Notes';
  it('maps full names to ids; blank means no requirement; foundational K and U are dropped', () => {
    const csv = [head, 'Color management,0.65,No,K3/U2/D3,4,,3,x', 'Attention to detail,0.9,Yes (Do only),D3,n/a,n/a,4,'].join('\n');
    const r = readRequired(csv, comps);
    expect(r.required['color-management']).toEqual({ k: 4, u: null, d: 3 });
    expect(r.required['attention-to-detail']).toEqual({ k: null, u: null, d: 4 });
  });
  it('rejects an unknown competency name or a value outside 0-5', () => {
    expect(() => readRequired([head, 'Colour mgmt,1,No,,1,1,1,'].join('\n'), comps)).toThrow(/Colour mgmt/);
    expect(() => readRequired([head, 'Color management,1,No,,6,1,1,'].join('\n'), comps)).toThrow(/0 and 5/);
  });
});

describe('readLinks', () => {
  const head = 'Later course,Earlier course,Competency,Earlier course leaves at (reference),Later course leaves at (reference),Link real for this competency? (Yes/No),Expected incoming K,Expected incoming U,Expected incoming D,Notes';
  it('keeps only Yes rows, maps names to codes and ids, blank expectation stays null', () => {
    const csv = [
      head,
      'GC 2070 Graphic Communications II,GC 1040 Graphic Communications I,Color management,K1,K2,Yes,2,,3,',
      'GC 2070 Graphic Communications II,GC 1040 Graphic Communications I,Color management,K1,K2,No,5,5,5,',
      'GC 2070 Graphic Communications II,GC 1040 Graphic Communications I,Color management,K1,K2,,5,5,5,',
    ].join('\n');
    const r = readLinks(csv, comps, courses);
    expect(r.links).toEqual([{ later: 'GC 2070', earlier: 'GC 1040', competency: 'color-management', expected: { k: 2, u: null, d: 3 } }]);
  });
  it('drops a link on a foundational competency with a warning, and rejects courses off the path', () => {
    const csv = [head, 'GC 2070 x,GC 1040 y,Attention to detail,,,Yes,,,3,'].join('\n');
    const r = readLinks(csv, comps, courses);
    expect(r.links).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/foundational/);
    expect(() => readLinks([head, 'GC 9999 x,GC 1040 y,Color management,,,Yes,1,1,1,'].join('\n'), comps, courses)).toThrow(/GC 9999/);
  });
});
