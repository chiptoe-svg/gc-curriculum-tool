import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const insertMock = vi.fn();
const selectMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({ values: (rows: unknown) => insertMock(rows) }),
    select: () => ({ from: () => ({ where: (w: unknown) => ({ orderBy: (o: unknown) => selectMock({ w, o }) }) }) }),
    delete: () => ({ where: (w: unknown) => deleteMock(w) }),
  },
}));

import {
  appendMessage,
  getSessionMessages,
  listPriorSessionSummaries,
  startNewSession,
} from '@/lib/db/capture-messages-queries';

describe('capture-messages-queries', () => {
  beforeEach(() => {
    insertMock.mockReset().mockResolvedValue(undefined);
    selectMock.mockReset().mockResolvedValue([]);
    deleteMock.mockReset().mockResolvedValue(undefined);
  });

  describe('startNewSession', () => {
    it('returns a fresh UUID', () => {
      const id1 = startNewSession();
      const id2 = startNewSession();
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('appendMessage', () => {
    it('inserts a row with the supplied fields', async () => {
      const sessionId = '11111111-1111-1111-1111-111111111111';
      await appendMessage({
        courseCode: 'GC 4800',
        sessionId,
        turnIndex: 0,
        role: 'user',
        content: 'hello',
      });
      expect(insertMock).toHaveBeenCalledOnce();
      const row = insertMock.mock.calls[0]![0];
      expect(row.courseCode).toBe('GC 4800');
      expect(row.sessionId).toBe(sessionId);
      expect(row.turnIndex).toBe(0);
      expect(row.role).toBe('user');
      expect(row.content).toBe('hello');
    });

    it('passes through tool calls and citations when supplied', async () => {
      await appendMessage({
        courseCode: 'GC 4800',
        sessionId: '22222222-2222-2222-2222-222222222222',
        turnIndex: 3,
        role: 'assistant',
        content: 'I see in your rubric...',
        citations: [{ type: 'chunk', chunkId: 'chunk-1', excerpt: 'tolerance ΔE 2.0' }],
        toolCalls: [{ id: 'tc-1', toolName: 'fetch_material_section', args: { materialId: 'm-1', query: 'rubric' } }],
      });
      const row = insertMock.mock.calls[0]![0];
      expect(row.citations).toEqual([{ type: 'chunk', chunkId: 'chunk-1', excerpt: 'tolerance ΔE 2.0' }]);
      expect(row.toolCalls).toEqual([{ id: 'tc-1', toolName: 'fetch_material_section', args: { materialId: 'm-1', query: 'rubric' } }]);
    });
  });

  describe('getSessionMessages', () => {
    it('queries by (courseCode, sessionId) and orders by turnIndex', async () => {
      selectMock.mockResolvedValue([
        { id: 'm-1', turnIndex: 0, role: 'user', content: 'hi' },
        { id: 'm-2', turnIndex: 1, role: 'assistant', content: 'hello' },
      ]);
      const rows = await getSessionMessages('GC 4800', '33333333-3333-3333-3333-333333333333');
      expect(rows.length).toBe(2);
      expect(selectMock).toHaveBeenCalledOnce();
    });
  });
});

describe('listPriorSessionSummaries — session_id is uuid, never bind ""', () => {
  const dialect = new PgDialect();
  const lastWhereSql = (): string => {
    const arg = selectMock.mock.calls.at(-1)![0] as { w: SQL };
    return dialect.sqlToQuery(arg.w).sql;
  };

  beforeEach(() => {
    selectMock.mockReset().mockResolvedValue([]);
  });

  it('omits the session-exclusion (<>) when excludeSessionId is empty', async () => {
    // The capture page passes `currentSessionId ?? ''` — an empty string. Since
    // session_id is a uuid column, `session_id <> ''` would throw at Postgres
    // ("invalid input syntax for type uuid"). The empty case must filter by
    // course alone, with no `<>` comparison.
    await listPriorSessionSummaries('GC 3400', '', 3);
    const sql = lastWhereSql();
    expect(sql).toContain('course_code');
    expect(sql).not.toContain('<>');
  });

  it('applies the session-exclusion (<>) when a real session id is given', async () => {
    await listPriorSessionSummaries('GC 3400', '11111111-1111-1111-1111-111111111111', 3);
    expect(lastWhereSql()).toContain('<>');
  });
});
