import { describe, it, expect } from 'vitest';
import { streamAuditAgent } from '../audit-agent-stream';

describe('streamAuditAgent', () => {
  it('exposes an async generator', () => {
    const gen = streamAuditAgent({
      sessionId: '00000000-0000-0000-0000-000000000000',
      courseCode: 'GC 0000',
      auditMode: 'full',
    });
    expect(typeof gen[Symbol.asyncIterator]).toBe('function');
  });
});
