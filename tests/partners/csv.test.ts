import { describe, it, expect } from 'vitest';
import { parsePartnersCsv } from '@/lib/partners/csv';

const HEADER = 'email,firstName,lastName,company,roleTitle,weight,careerTargetHints';

describe('parsePartnersCsv', () => {
  it('parses a valid row', () => {
    const csv = `${HEADER}\nalex@acme.test,Alex,Jordan,Acme Print,Plant Manager,3,production-operations`;
    const result = parsePartnersCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      email: 'alex@acme.test',
      firstName: 'Alex',
      lastName: 'Jordan',
      company: 'Acme Print',
      roleTitle: 'Plant Manager',
      weight: 3,
      careerTargetHints: ['production-operations'],
    });
  });

  it('defaults missing weight to 1 and missing roleTitle to null', () => {
    const csv = `${HEADER}\nalex@acme.test,Alex,Jordan,Acme,,,`;
    const { rows, errors } = parsePartnersCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]!.weight).toBe(1);
    expect(rows[0]!.roleTitle).toBeNull();
    expect(rows[0]!.careerTargetHints).toEqual([]);
  });

  it('parses multiple careerTargetHints separated by pipe', () => {
    const csv = `${HEADER}\nalex@acme.test,Alex,Jordan,Acme,,1,production-operations|workflow-management`;
    const { rows } = parsePartnersCsv(csv);
    expect(rows[0]!.careerTargetHints).toEqual(['production-operations', 'workflow-management']);
  });

  it('reports per-row errors with row numbers and continues parsing', () => {
    const csv = [
      HEADER,
      'not-an-email,Alex,J,Acme,,1,',
      'beth@acme.test,Beth,Smith,Acme,,1,',
      ',Carl,Diaz,Acme,,1,',
    ].join('\n');
    const { rows, errors } = parsePartnersCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe('beth@acme.test');
    expect(errors).toHaveLength(2);
    expect(errors[0]!).toMatchObject({ row: 2 });
    expect(errors[0]!.message).toMatch(/email/i);
    expect(errors[1]!).toMatchObject({ row: 4 });
    expect(errors[1]!.message).toMatch(/email/i);
  });

  it('rejects unknown headers and missing required headers', () => {
    const result1 = parsePartnersCsv('email,firstName\nalex@acme.test,Alex');
    expect(result1.errors[0]!.message).toMatch(/missing header/i);


    const result2 = parsePartnersCsv(`${HEADER},extraCol\nalex@acme.test,Alex,Jordan,Acme,,1,,oops`);
    expect(result2.errors.some(e => /unknown header/i.test(e.message))).toBe(true);
  });

  it('strips UTF-8 BOM and trims whitespace from cells', () => {
    const csv = `﻿${HEADER}\n  alex@acme.test ,  Alex  ,Jordan,Acme,,1,`;
    const { rows, errors } = parsePartnersCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]!.email).toBe('alex@acme.test');
    expect(rows[0]!.firstName).toBe('Alex');
  });
});
