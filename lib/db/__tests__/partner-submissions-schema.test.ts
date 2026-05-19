import { describe, it, expect } from 'vitest';
import { partnerSubmissions } from '@/lib/db/schema';

describe('partner_submissions schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(partnerSubmissions);
    for (const c of ['id', 'partnerId', 'careerTargetId', 'unmappedTargetLabel',
                     'positionTitle', 'responsibilities', 'salaryRangeLow', 'salaryRangeHigh',
                     'salaryCurrency', 'interviewQuestions', 'requiredSkills',
                     'niceToHaveSkills', 'additionalNotes', 'status', 'createdAt',
                     'updatedAt', 'submittedAt']) {
      expect(cols).toContain(c);
    }
  });
});
