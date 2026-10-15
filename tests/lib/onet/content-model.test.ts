import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseContentModelReferenceCsv } from '@/lib/onet/load';

const FIX = path.join(process.cwd(), 'tests/fixtures/onet');

describe('parseContentModelReferenceCsv', () => {
  it('parses id, name, description', () => {
    const { rows } = parseContentModelReferenceCsv(readFileSync(path.join(FIX, 'content_model_reference.csv'), 'utf8'), 'content_model_reference.csv');
    expect(rows).toHaveLength(9);
    expect(rows[0]).toEqual({ elementId: '2.C.1.a', elementName: 'Administration and Management', description: 'Synthetic definition A.' });
  });
  it('fails loudly on a renamed column', () => {
    expect(() => parseContentModelReferenceCsv('Element ID,Name,Description\n1,x,y\n', 'cmr.csv'))
      .toThrow(/cmr\.csv: missing or renamed column "Element Name"/);
  });
});
