import type { V2SynthesisContext } from '../../capture-scores';

type Row = V2SynthesisContext['transcript'][number];
const row = (o: Partial<Row> & Pick<Row, 'role' | 'turnIndex'>): Row => ({
  id: `00000000-0000-4000-8000-00000000000${o.turnIndex}`,
  courseCode: 'GC 9999',
  sessionId: '11111111-1111-4111-8111-111111111111',
  content: null,
  toolCalls: null,
  toolResult: null,
  citations: null,
  instructorName: 'Dr. Fixture',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  ...o,
}) as Row;

export const richContext: V2SynthesisContext = {
  chatContext: {
    course: {
      code: 'GC 9999', title: 'Fixture Course', description: 'A fixture.', prerequisites: 'GC 1010',
      learningObjectives: ['Do a thing', 'Explain a thing'], majorProjects: ['Project A'], skillsRequired: ['Skill A'],
    },
    builderProfile: null,
    materials: [{
      id: 'm1', fileName: 'syllabus.pdf', extractionStatus: 'done',
      extractedText: 'Week 1: ink. Week 2: press.', digest: null, useDigest: false,
    }],
    priorCaptureProfile: null,
    prerequisiteCaptureProfiles: [],
  },
  sessionId: '11111111-1111-4111-8111-111111111111',
  transcript: [
    row({ role: 'user', turnIndex: 0, content: 'Tell me what students make.' }),
    row({
      role: 'assistant', turnIndex: 1,
      content: JSON.stringify({ finding: 'The syllabus lists a press project.', question: 'Is it graded?' }),
      citations: [{ type: 'chunk', chunkId: 'abcdef0123456789', excerpt: 'Week 2: press.' }],
    }),
    row({ role: 'user', turnIndex: 2, content: 'Yes, 30% of the grade.' }),
    row({
      role: 'assistant', turnIndex: 3,
      content: JSON.stringify({ finding: 'Press project is 30%.', question: 'Any revisions?' }),
      citations: [{ type: 'instructor', messageId: '00000000-0000-4000-8000-000000000002', excerpt: '30% of the grade' }],
    }),
    row({ role: 'tool', turnIndex: 4, toolResult: [{ toolCallId: 'call_abcdef123456', result: {} }] }),
  ],
};
