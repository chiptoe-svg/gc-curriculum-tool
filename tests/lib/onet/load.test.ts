// @vitest-environment node
// P1 Task 4 — unit tests for the pure O*NET CSV parsing in lib/onet/load.ts.
// Small synthetic fixtures only (tests/fixtures/onet/); no DB.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  domainForFile,
  parseYn,
  taskRatingCategory,
  filterToCodes,
  parseOccupationDataCsv,
  parseElementRatingsCsv,
  parseTaskStatementsCsv,
  parseTaskRatingsCsv,
  ONET_ATTRIBUTION,
  DOMAIN_BY_FILENAME,
} from '@/lib/onet/load';

const FIXTURES = path.join(process.cwd(), 'tests/fixtures/onet');
const read = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

describe('ONET_ATTRIBUTION', () => {
  it('matches the exact global-constraints CC BY 4.0 text', () => {
    expect(ONET_ATTRIBUTION).toBe(
      'This product includes information from O*NET 31.0 Database by the U.S. Department of Labor, ' +
      'Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license.',
    );
  });
});

describe('domainForFile — Ruling 5 domain mapping', () => {
  it('maps every fixed filename to its domain', () => {
    expect(domainForFile('knowledge.csv')).toBe('knowledge');
    expect(domainForFile('abilities.csv')).toBe('abilities');
    expect(domainForFile('work_activities.csv')).toBe('work_activities');
    expect(domainForFile('essential_skills.csv')).toBe('essential_skills');
    expect(domainForFile('transferable_skills.csv')).toBe('transferable_skills');
    expect(Object.keys(DOMAIN_BY_FILENAME)).toHaveLength(5);
  });

  it('throws on an unrecognized filename', () => {
    expect(() => domainForFile('software_skills.csv')).toThrow(/unrecognized element file/);
  });
});

describe('header checking — missing or renamed column fails loudly, naming file and column', () => {
  it('refuses a knowledge-shaped file missing "Not Relevant" (renamed/dropped column)', () => {
    const content = read('bad-header-knowledge.csv');
    expect(() => parseElementRatingsCsv(content, 'bad-header-knowledge.csv', 'knowledge')).toThrow(
      /bad-header-knowledge\.csv: missing or renamed column "Not Relevant"/,
    );
  });

  it('refuses a task_ratings-shaped file missing "Category"', () => {
    const content = 'O*NET-SOC Code,Title,Task ID,Task,Scale ID,Scale Name,Data Value,N,Standard Error,Lower CI Bound,Upper CI Bound,Recommend Suppress,Date,Domain Source\n'
      + '99-0001.00,X,1,"t",IM,Importance,4.0,1,0.1,3.9,4.1,N,08/2023,Incumbent\n';
    expect(() => parseTaskRatingsCsv(content, 'in-memory-task-ratings.csv')).toThrow(
      /in-memory-task-ratings\.csv: missing or renamed column "Category"/,
    );
  });

  it('refuses an occupation file missing "Description"', () => {
    const content = 'O*NET-SOC Code,Title\n99-0001.00,X\n';
    expect(() => parseOccupationDataCsv(content, 'in-memory-occupation.csv')).toThrow(
      /in-memory-occupation\.csv: missing or renamed column "Description"/,
    );
  });
});

describe('parseYn — blank/Y/N booleans', () => {
  it('blank becomes false', () => {
    expect(parseYn('')).toBe(false);
    expect(parseYn(undefined)).toBe(false);
    expect(parseYn('   ')).toBe(false);
  });
  it('Y becomes true, N becomes false', () => {
    expect(parseYn('Y')).toBe(true);
    expect(parseYn('N')).toBe(false);
  });
  it('refuses an unexpected value', () => {
    expect(() => parseYn('maybe')).toThrow(/unexpected Y\/N value/);
  });
});

describe('taskRatingCategory — FT keeps category, others use \'\'', () => {
  it('FT keeps its category', () => {
    expect(taskRatingCategory('FT', '3')).toBe('3');
  });
  it('IM and RT use \'\' regardless of the raw category field', () => {
    expect(taskRatingCategory('IM', '')).toBe('');
    expect(taskRatingCategory('RT', 'should be ignored')).toBe('');
  });
});

describe('filterToCodes', () => {
  it('keeps only rows whose onetSocCode is in the set', () => {
    const rows = [{ onetSocCode: '99-0001.00', v: 1 }, { onetSocCode: '99-0003.00', v: 2 }];
    expect(filterToCodes(rows, new Set(['99-0001.00']))).toEqual([{ onetSocCode: '99-0001.00', v: 1 }]);
  });
  it('returns empty when the set is empty', () => {
    const rows = [{ onetSocCode: '99-0001.00', v: 1 }];
    expect(filterToCodes(rows, new Set())).toEqual([]);
  });
});

describe('parseOccupationDataCsv (fixture)', () => {
  it('parses all 3 synthetic occupations', () => {
    const { rows } = parseOccupationDataCsv(read('occupation_data.csv'), 'occupation_data.csv');
    expect(rows.map(r => r.onetSocCode)).toEqual(['99-0001.00', '99-0002.00', '99-0003.00']);
    expect(rows[1]!.description).toContain('comma');
  });
});

describe('parseElementRatingsCsv (fixture: knowledge.csv)', () => {
  const { rows, skippedScaleCount } = parseElementRatingsCsv(read('knowledge.csv'), 'knowledge.csv', 'knowledge');

  it('keeps only IM/LV rows and skips+counts the OJ (unused test scale) row', () => {
    expect(rows.every(r => r.scaleId === 'IM' || r.scaleId === 'LV')).toBe(true);
    expect(skippedScaleCount).toBe(1); // the one 'OJ' row in the fixture
  });

  it('tags every row with the passed-in domain', () => {
    expect(rows.every(r => r.domain === 'knowledge')).toBe(true);
  });

  it('maps blank Recommend Suppress/Not Relevant to false, and Y to true', () => {
    const imRow1 = rows.find(r => r.onetSocCode === '99-0001.00' && r.scaleId === 'IM')!;
    expect(imRow1.recommendSuppress).toBe(false);
    expect(imRow1.notRelevant).toBe(false);

    const lvRow1 = rows.find(r => r.onetSocCode === '99-0001.00' && r.scaleId === 'LV')!;
    expect(lvRow1.recommendSuppress).toBe(false);
    expect(lvRow1.notRelevant).toBe(false);

    const imRow2 = rows.find(r => r.onetSocCode === '99-0002.00' && r.scaleId === 'IM')!;
    expect(imRow2.recommendSuppress).toBe(true);
    expect(imRow2.notRelevant).toBe(true);
  });

  it('parses numeric fields', () => {
    const imRow1 = rows.find(r => r.onetSocCode === '99-0001.00' && r.scaleId === 'IM')!;
    expect(imRow1.dataValue).toBe(4.5);
    expect(imRow1.n).toBe(10);
    expect(imRow1.standardError).toBeCloseTo(0.1);
  });
});

describe('parseTaskStatementsCsv (fixture)', () => {
  const { rows } = parseTaskStatementsCsv(read('task_statements.csv'), 'task_statements.csv');

  it('parses all 4 synthetic task statements', () => {
    expect(rows).toHaveLength(4);
  });

  it('keeps Core/Supplemental task types and null-s a blank one', () => {
    expect(rows.find(r => r.taskId === '90001')!.taskType).toBe('Core');
    expect(rows.find(r => r.taskId === '90002')!.taskType).toBe('Supplemental');
    expect(rows.find(r => r.taskId === '90003')!.taskType).toBeNull();
  });
});

describe('parseTaskRatingsCsv (fixture: task_ratings.csv)', () => {
  const { rows, skippedScaleCount } = parseTaskRatingsCsv(read('task_ratings.csv'), 'task_ratings.csv');

  it('keeps only IM/RT/FT and skips+counts the XX (unused test scale) row', () => {
    expect(rows.every(r => r.scaleId === 'IM' || r.scaleId === 'RT' || r.scaleId === 'FT')).toBe(true);
    expect(skippedScaleCount).toBe(1); // the one 'XX' row in the fixture
  });

  it('FT rows keep their category; IM/RT rows store \'\'', () => {
    const ft1 = rows.filter(r => r.scaleId === 'FT' && r.taskId === '90001');
    expect(ft1.map(r => r.category).sort()).toEqual(['1', '2']);

    const im = rows.find(r => r.scaleId === 'IM' && r.taskId === '90001')!;
    expect(im.category).toBe('');
    const rt = rows.find(r => r.scaleId === 'RT' && r.taskId === '90001')!;
    expect(rt.category).toBe('');
  });

  it('maps blank/Y Recommend Suppress correctly', () => {
    const suppressedRow = rows.find(r => r.onetSocCode === '99-0002.00')!;
    expect(suppressedRow.recommendSuppress).toBe(true);
    const normalRow = rows.find(r => r.onetSocCode === '99-0001.00' && r.scaleId === 'IM')!;
    expect(normalRow.recommendSuppress).toBe(false);
  });
});
