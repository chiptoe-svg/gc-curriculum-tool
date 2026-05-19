import { describe, it, expect } from 'vitest';
import { buildSynthesisUserMessage } from '@/lib/ai/synthesis/prompt-builder';

const target = {
  id: 'production-operations',
  name: 'Production Operations',
  shortDefinition: 'Running the press floor day-to-day.',
  knowDescriptors: ['Press mechanics fundamentals', 'Substrate behavior under heat and pressure'],
  understandDescriptors: ['How a make-ready decision affects yield'],
  doDescriptors: ['Sustain a target color tolerance across a 10k impression run'],
};

const submissions = [
  {
    partnerId: 'p1', firstName: 'Alex', lastName: 'Jordan', company: 'Acme Print', weight: 1,
    positionTitle: 'Press Operator', responsibilities: 'Run the 8-color press; troubleshoot.',
    requiredSkills: ['Color management'], niceToHaveSkills: ['GMI cert'],
    interviewQuestions: ['How do you sequence a make-ready?'],
    additionalNotes: 'Want grads who can work nights.',
    salaryRangeLow: 48000, salaryRangeHigh: 55000, salaryCurrency: 'USD',
  },
  {
    partnerId: 'p2', firstName: 'Beth', lastName: 'Smith', company: 'Coca-Cola', weight: 5,
    positionTitle: 'Packaging Color Lead', responsibilities: 'Brand color governance across suppliers.',
    requiredSkills: ['Color management', 'Pantone Live'], niceToHaveSkills: [],
    interviewQuestions: [],
    additionalNotes: '',
    salaryRangeLow: 80000, salaryRangeHigh: 110000, salaryCurrency: 'USD',
  },
];

const salaryDistribution = { p25: 51500, p50: 70000, p75: 95000, n: 2 };

describe('buildSynthesisUserMessage', () => {
  it('includes career target identity and current KUD descriptors', () => {
    const msg = buildSynthesisUserMessage({ target, submissions, salaryDistribution });
    expect(msg).toContain('Production Operations');
    expect(msg).toContain('production-operations');
    expect(msg).toContain('Press mechanics fundamentals');
    expect(msg).toContain('Sustain a target color tolerance');
  });

  it('numbers each KUD descriptor zero-based so the LLM can target edits by index', () => {
    const msg = buildSynthesisUserMessage({ target, submissions, salaryDistribution });
    expect(msg).toMatch(/Know:[\s\S]+\[0\] Press mechanics fundamentals/);
    expect(msg).toMatch(/\[1\] Substrate behavior under heat and pressure/);
  });

  it('lists every submission with partner identity + weight', () => {
    const msg = buildSynthesisUserMessage({ target, submissions, salaryDistribution });
    expect(msg).toContain('p1');
    expect(msg).toContain('Alex Jordan (Acme Print, weight: 1)');
    expect(msg).toContain('Beth Smith (Coca-Cola, weight: 5)');
    expect(msg).toContain('Brand color governance across suppliers');
  });

  it('includes the salary distribution passthrough block', () => {
    const msg = buildSynthesisUserMessage({ target, submissions, salaryDistribution });
    expect(msg).toMatch(/Salary distribution.*p25.*51500/s);
    expect(msg).toContain('"n": 2');
  });

  it('omits empty fields without leaving dangling labels', () => {
    const msg = buildSynthesisUserMessage({ target, submissions, salaryDistribution });
    // p2 has empty interviewQuestions, empty niceToHave, and empty additionalNotes
    expect(msg).not.toMatch(/Interview questions:\s*\n\s*Required skills/);
  });
});
