import { describe, it, expect, vi, beforeEach } from 'vitest';

const { complete, getProviderForFunction, recordSpend } = vi.hoisted(() => {
  const complete = vi.fn();
  return {
    complete,
    getProviderForFunction: vi.fn(async () => ({ name: 'fake', model: 'fake-light', complete })),
    recordSpend: vi.fn(async () => {}),
  };
});
vi.mock('@/lib/ai/provider', () => ({ getProviderForFunction }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: vi.fn(async () => 'SYSTEM PROMPT') }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ recordSpend }));

import { scrubForRecord, needsNamePass, ScrubError } from '@/lib/privacy/scrub';

process.env.PRIVACY_SCRUB_RETRY_DELAY_MS = '0';

/** A fake model that replaces the given names with [student] and echoes everything else. */
function modelReplacing(names: string[]) {
  return async (args: { userMessage: string; validate: (raw: unknown) => { text: string } }) => {
    let text = args.userMessage;
    for (const n of names) text = text.split(n).join('[student]');
    return {
      data: args.validate({ text }),
      costUsdCents: 7, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0,
    };
  };
}

beforeEach(() => {
  complete.mockReset();
  getProviderForFunction.mockClear();
  recordSpend.mockClear();
});

describe('scrubForRecord — deterministic only', () => {
  it('does not call the AI for a file with no name signals', async () => {
    const r = await scrubForRecord('Week 3: halftone screening. Contact C12345678.', {
      fileName: 'Canvas File: week3.pdf', isSyllabus: false,
    });
    expect(r.text).toBe('Week 3: halftone screening. Contact [student ID].');
    expect(r.redactions).toEqual({ 'student-name': 0, 'student-id': 1, email: 0 });
    expect(complete).not.toHaveBeenCalled();
  });

  it('keeps emails in a syllabus and removes them elsewhere', async () => {
    const text = 'Instructor: prof@clemson.edu';
    expect((await scrubForRecord(text, { fileName: 'Canvas: Syllabus', isSyllabus: true })).text).toBe(text);
    expect((await scrubForRecord(text, { fileName: 'notes.pdf', isSyllabus: false })).text).toBe('Instructor: [email]');
  });

  it('returns text with nothing to remove unchanged', async () => {
    const text = 'Color management and ICC profiles.';
    const r = await scrubForRecord(text, { fileName: 'notes.pdf', isSyllabus: false });
    expect(r.text).toBe(text);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('scrubForRecord — AI name pass', () => {
  it('runs for flagged text and stores the input with only the names replaced', async () => {
    complete.mockImplementation(modelReplacing(['Jane Doe']));
    const raw = 'Submitted by Jane Doe\n\nThe poster uses a  CMYK palette.';
    const r = await scrubForRecord(raw, { fileName: 'Canvas: Assignments', isSyllabus: false });
    expect(getProviderForFunction).toHaveBeenCalledWith('privacy-scrub');
    expect(r.text).toBe('Submitted by [student]\n\nThe poster uses a  CMYK palette.');
    expect(r.redactions['student-name']).toBe(1);
    expect(recordSpend).toHaveBeenCalledWith(7);
  });

  it('always runs for Canvas: Discussions, even with no detector signal', async () => {
    complete.mockImplementation(modelReplacing(['Raj Patel']));
    const r = await scrubForRecord('Great point about kerning, Raj Patel.', {
      fileName: 'Canvas: Discussions', isSyllabus: false,
    });
    expect(complete).toHaveBeenCalledOnce();
    expect(r.text).toBe('Great point about kerning, [student].');
  });

  it('rejects with ScrubError when the model changes non-name text', async () => {
    complete.mockImplementation(async (args: { validate: (raw: unknown) => { text: string } }) => ({
      data: args.validate({ text: 'Submitted by [student]\nThe rubric has four criteria.' }),
      costUsdCents: 1, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0,
    }));
    const p = scrubForRecord('Submitted by Jane Doe\nThe rubric has five criteria.', {
      fileName: 'Canvas: Assignments', isSyllabus: false,
    });
    await expect(p).rejects.toBeInstanceOf(ScrubError);
    await expect(p).rejects.toThrow(/guard rejected chunk 1\/1/);
  });

  it('rejects with ScrubError when the provider call fails', async () => {
    complete.mockRejectedValue(new Error('request timed out'));
    await expect(scrubForRecord('Submitted by Jane Doe\nbody', { fileName: 'x.pdf', isSyllabus: false }))
      .rejects.toBeInstanceOf(ScrubError);
  });

  it('never leaks material text from a provider error into the ScrubError message', async () => {
    // Providers sometimes echo raw model content in their own error messages
    // (e.g. "OpenAI returned non-JSON content: <first 200 chars>"). That
    // content is material text — possibly containing an unredacted student
    // name — and must never end up in a ScrubError, because that message is
    // stored as course_materials.redactions.failedReason and logged.
    complete.mockRejectedValue(
      new Error('OpenAI returned non-JSON content: Submitted by Jane Doe, the poster uses CMYK...'),
    );
    const p = scrubForRecord('Submitted by Jane Doe\nbody', { fileName: 'x.pdf', isSyllabus: false });
    await expect(p).rejects.toBeInstanceOf(ScrubError);
    await expect(p).rejects.not.toThrow(/Jane/);
  });

  it('keeps the input\'s exact whitespace even when the model collapses it', async () => {
    // The model is instructed to change nothing but names, but the guard must
    // independently enforce that: here the fake model both substitutes the
    // name AND collapses whitespace (double blank line -> single, double
    // space -> single). The stored text must still be rebuilt from the
    // INPUT's exact whitespace, with only the name replaced.
    complete.mockImplementation(async (args: { userMessage: string; validate: (raw: unknown) => { text: string } }) => {
      const collapsed = args.userMessage
        .split('Jane Doe').join('[student]')
        .replace(/\n\n+/g, '\n')
        .replace(/ {2,}/g, ' ');
      return {
        data: args.validate({ text: collapsed }),
        costUsdCents: 7, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0,
      };
    });
    const raw = 'Submitted by Jane Doe\n\nThe poster uses a  CMYK palette.';
    const r = await scrubForRecord(raw, { fileName: 'Canvas: Assignments', isSyllabus: false });
    expect(r.text).toBe('Submitted by [student]\n\nThe poster uses a  CMYK palette.');
  });

  it('splits long text into chunks and joins the results', async () => {
    complete.mockImplementation(modelReplacing(['Jane Doe']));
    const raw = 'Submitted by Jane Doe\n'
      + 'Students practise color separation on press sheets.\n'.repeat(300)
      + 'Submitted by Jane Doe\n';
    const r = await scrubForRecord(raw, { fileName: 'Canvas: Assignments', isSyllabus: false });
    expect(complete.mock.calls.length).toBeGreaterThan(1);
    expect(r.text).toBe(raw.split('Jane Doe').join('[student]'));
  });
});

describe('scrubForRecord — one retry per chunk', () => {
  const ok = (text: string) => ({ data: { text }, costUsdCents: 1, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 });

  it('succeeds when the first provider call fails and the retry succeeds', async () => {
    complete
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
      .mockImplementationOnce(modelReplacing(['Jane Doe']));
    const r = await scrubForRecord('Submitted by Jane Doe\nbody', { fileName: 'x.pdf', isSyllabus: false });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(r.text).toBe('Submitted by [student]\nbody');
  });

  it('succeeds when the first output is rejected by the guard and the retry is clean', async () => {
    complete
      .mockResolvedValueOnce(ok('Submitted by [student]\nsomething else entirely'))
      .mockImplementationOnce(modelReplacing(['Jane Doe']));
    const r = await scrubForRecord('Submitted by Jane Doe\nbody', { fileName: 'x.pdf', isSyllabus: false });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(r.text).toBe('Submitted by [student]\nbody');
  });

  it('throws a text-free ScrubError when both attempts fail, after exactly two calls', async () => {
    complete.mockRejectedValue(new Error('OpenAI returned non-JSON content: Submitted by Jane Doe'));
    const p = scrubForRecord('Submitted by Jane Doe\nbody', { fileName: 'x.pdf', isSyllabus: false });
    await expect(p).rejects.toBeInstanceOf(ScrubError);
    await expect(p).rejects.not.toThrow(/Jane/);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('throws a text-free ScrubError when the guard rejects both attempts', async () => {
    complete.mockResolvedValue(ok('Submitted by [student]\nJane Doe rewrote this'));
    const p = scrubForRecord('Submitted by Jane Doe\nbody', { fileName: 'x.pdf', isSyllabus: false });
    await expect(p).rejects.toBeInstanceOf(ScrubError);
    await expect(p).rejects.not.toThrow(/Jane/);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});

describe('needsNamePass', () => {
  it('is true for name-shaped detector rules and for discussions', () => {
    expect(needsNamePass('Submitted by Jane Doe', 'a.pdf')).toBe(true);
    expect(needsNamePass('| Student | Score |\n| A B | 9 |', 'a.pdf')).toBe(true);
    expect(needsNamePass('anything', 'Canvas: Discussions')).toBe(true);
  });
  it('is false for IDs or emails alone (the deterministic pass handles those)', () => {
    expect(needsNamePass('[student ID] and [email] and [email]', 'a.pdf')).toBe(false);
    expect(needsNamePass('Plain course prose.', 'a.pdf')).toBe(false);
  });
});
