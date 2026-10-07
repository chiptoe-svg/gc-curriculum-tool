// Owner, 2026-10-07: after a profile was generated (the saved conversation is
// cleared), the morning's session vanished from "Where we left off" because the
// page treated it as still in progress.
import { describe, it, expect } from 'vitest';
import { sessionToExcludeFromRecap } from '@/lib/capture/session-recap';

describe('sessionToExcludeFromRecap', () => {
  it('excludes the latest session only while a saved conversation is being resumed', () => {
    expect(sessionToExcludeFromRecap('s-latest', { messages: [{ role: 'assistant', content: 'hi' }] })).toBe('s-latest');
  });
  it('excludes nothing when there is no saved conversation (e.g. after generating a profile)', () => {
    expect(sessionToExcludeFromRecap('s-latest', null)).toBe('');
    expect(sessionToExcludeFromRecap('s-latest', { messages: [] })).toBe('');
  });
  it('excludes nothing when there is no session at all', () => {
    expect(sessionToExcludeFromRecap(null, { messages: [{ role: 'user', content: 'x' }] })).toBe('');
  });
});
