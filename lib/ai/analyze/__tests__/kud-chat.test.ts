import { describe, it, expect } from 'vitest';
import { buildKudChatUserMessage } from '../kud-chat';

describe('buildKudChatUserMessage', () => {
  it('includes course title and profile fields', () => {
    const msg = buildKudChatUserMessage({
      title: 'Data Structures',
      description: 'Algorithms and data organization.',
      learningObjectives: ['Implement linked lists'],
      majorProjects: ['Final sorting benchmark'],
      skillsRequired: ['Python basics'],
    });
    expect(msg).toContain('Data Structures');
    expect(msg).toContain('Final sorting benchmark');
    expect(msg).toContain('Implement linked lists');
  });

  it('handles empty arrays gracefully', () => {
    const msg = buildKudChatUserMessage({
      title: 'New Course',
      description: '',
      learningObjectives: [],
      majorProjects: [],
      skillsRequired: [],
    });
    expect(msg).toContain('(none)');
  });
});
