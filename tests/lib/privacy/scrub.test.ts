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

/** A fake model that lists the given names. */
function modelListing(names: string[]) {
  return async (args: { userMessage: string; validate: (raw: unknown) => { names: string[] } }) => ({
    data: args.validate({ names }),
    costUsdCents: 7, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0,
  });
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
  it('runs for flagged text and stores the input with only the listed names replaced', async () => {
    complete.mockImplementation(modelListing(['Jane Doe']));
    const raw = 'Submitted by Jane Doe\n\nThe poster uses a  CMYK palette.';
    const r = await scrubForRecord(raw, { fileName: 'Canvas: Assignments', isSyllabus: false });
    expect(getProviderForFunction).toHaveBeenCalledWith('privacy-scrub');
    expect(r.text).toBe('Submitted by [student]\n\nThe poster uses a  CMYK palette.');
    expect(r.redactions['student-name']).toBe(1);
    expect(recordSpend).toHaveBeenCalledWith(7);
  });

  it('replaces a name everywhere it occurs, including possessives', async () => {
    complete.mockImplementation(modelListing(['Jane']));
    const r = await scrubForRecord("Submitted by Jane\nJane's poster; Janet's is separate.", {
      fileName: 'Canvas: Assignments', isSyllabus: false,
    });
    expect(r.text).toBe("Submitted by [student]\n[student]'s poster; Janet's is separate.");
  });

  it('replaces the longest listed name first', async () => {
    complete.mockImplementation(modelListing(['Jane', 'Jane Doe']));
    const r = await scrubForRecord('Submitted by Jane Doe\nJane revised it.', { fileName: 'x.pdf', isSyllabus: false });
    expect(r.text).toBe('Submitted by [student]\n[student] revised it.');
    expect(r.redactions['student-name']).toBe(2);
  });

  it('ignores listed names that do not occur in the text and changes nothing else', async () => {
    complete.mockImplementation(modelListing(['Raj Patel', 'five', 'Jane Doe', 'Submitted by Jane Doe\nThe']));
    const raw = 'Submitted by Jane Doe\nThe rubric has five criteria.';
    const r = await scrubForRecord(raw, { fileName: 'Canvas: Assignments', isSyllabus: false });
    expect(r.text).toBe('Submitted by [student]\nThe rubric has five criteria.');
  });

  it('leaves the text byte-identical when the model lists no names', async () => {
    complete.mockImplementation(modelListing([]));
    const raw = 'Posted by the instructor\r\n\tKerning  notes —\u00a0see below.';
    const r = await scrubForRecord(raw, { fileName: 'Canvas: Discussions', isSyllabus: false });
    expect(r.text).toBe(raw);
    expect(r.redactions['student-name']).toBe(0);
  });

  it('always runs for Canvas: Discussions, even with no detector signal', async () => {
    complete.mockImplementation(modelListing(['Raj Patel']));
    const r = await scrubForRecord('Great point about kerning, Raj Patel.', {
      fileName: 'Canvas: Discussions', isSyllabus: false,
    });
    expect(complete).toHaveBeenCalledOnce();
    expect(r.text).toBe('Great point about kerning, [student].');
  });

  it('skips the AI name pass for syllabi, even when name-shaped', async () => {
    const raw = 'Submitted by Jane Doe\nInstructor: prof@clemson.edu, C12345678';
    const r = await scrubForRecord(raw, { fileName: 'Canvas: Discussions', isSyllabus: true });
    expect(complete).not.toHaveBeenCalled();
    expect(getProviderForFunction).not.toHaveBeenCalled();
    expect(r.text).toBe('Submitted by Jane Doe\nInstructor: prof@clemson.edu, [student ID]');
  });

  it('applies a name found in one chunk to the whole material', async () => {
    // The model sees each chunk separately; a name it finds in one chunk is
    // replaced wherever it occurs in the material.
    complete
      .mockImplementationOnce(modelListing(['Jane Doe']))
      .mockImplementation(modelListing([]));
    const raw = 'Submitted by Jane Doe\n'
      + 'Students practise color separation on press sheets.\n'.repeat(300)
      + 'Thanks, Jane Doe\n';
    const r = await scrubForRecord(raw, { fileName: 'Canvas: Assignments', isSyllabus: false });
    expect(complete.mock.calls.length).toBeGreaterThan(1);
    expect(r.text).toBe(raw.split('Jane Doe').join('[student]'));
  });

  it('asks for a strict schema whose properties are all required', async () => {
    complete.mockImplementation(modelListing([]));
    await scrubForRecord('Submitted by Jane Doe', { fileName: 'x.pdf', isSyllabus: false });
    const schema = complete.mock.calls[0]![0].jsonSchema as {
      type: string; additionalProperties: boolean; required: string[];
      properties: Record<string, { type: string; items?: { type: string } }>;
    };
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    expect(schema.properties.names).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('rejects a response without a names array (validate throws)', async () => {
    complete.mockImplementation(async (args: { validate: (raw: unknown) => unknown }) => ({
      data: args.validate({ text: 'Submitted by [student]' }),
      costUsdCents: 1, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0,
    }));
    await expect(scrubForRecord('Submitted by Jane Doe', { fileName: 'x.pdf', isSyllabus: false }))
      .rejects.toBeInstanceOf(ScrubError);
  });

  it('never leaks material text from a provider error into the ScrubError message', async () => {
    complete.mockRejectedValue(
      new Error('OpenAI returned non-JSON content: Submitted by Jane Doe, the poster uses CMYK...'),
    );
    const p = scrubForRecord('Submitted by Jane Doe\nbody', { fileName: 'x.pdf', isSyllabus: false });
    await expect(p).rejects.toBeInstanceOf(ScrubError);
    await expect(p).rejects.not.toThrow(/Jane/);
  });
});

describe('scrubForRecord — one retry per chunk', () => {
  it('succeeds when the first provider call fails and the retry succeeds', async () => {
    complete
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
      .mockImplementationOnce(modelListing(['Jane Doe']));
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
});

describe('scrubForRecord — name-pass trigger sees the raw text', () => {
  it('runs the name pass when the name signal exists only before the email is replaced', async () => {
    // "Doe@clemson.edu" is one email to the deterministic pass, so after it
    // runs the line reads "Submitted by Jane [email]" and no longer matches the
    // submitted-by rule. The raw text does.
    complete.mockImplementation(modelListing(['Jane']));
    const r = await scrubForRecord('Submitted by Jane Doe@clemson.edu\nbody', { fileName: 'x.pdf', isSyllabus: false });
    expect(complete).toHaveBeenCalledOnce();
    expect(r.text).toBe('Submitted by [student] [email]\nbody');
  });

  it('still runs the name pass when the signal appears only after IDs are replaced', async () => {
    // "[student ID]" cells give the table a name-ish column, so the scrubbed
    // text is gradebook-shaped while the raw text is not. Keep today's trigger.
    complete.mockImplementation(modelListing(['Jane Doe', 'Raj Patel']));
    const raw = '| ID | Result |\n|---|---|\n| C12345678 | Jane Doe | 95% |\n| C12345679 | Raj Patel | 88% |';
    const r = await scrubForRecord(raw, { fileName: 'x.pdf', isSyllabus: false });
    expect(complete).toHaveBeenCalledOnce();
    expect(r.text).not.toMatch(/Jane|Raj/);
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
