import { describe, it, expect } from 'vitest';
import { transcriptToOkfMarkdown } from '@/lib/okf/transcript-to-okf';

const meta = {
  courseCode: 'GC 2400',
  courseTitle: 'Intro',
  slug: 'gc-2400',
  timestamp: '2026-06-15T00:00:00.000Z',
  resource: 'http://h/view/GC%202400',
};

describe('transcriptToOkfMarkdown', () => {
  it('renders user/assistant turns and skips system/tool/empty', () => {
    const md = transcriptToOkfMarkdown(
      [
        { role: 'system', content: 'You are an auditor.' },
        { role: 'user', content: 'We cover color theory.' },
        { role: 'assistant', content: 'How is it assessed?' },
        { role: 'tool', content: '{"x":1}' },
        { role: 'assistant', content: null },
      ],
      meta,
    );
    expect(md).toMatch(/^type: transcript$/m);
    expect(md).toContain('**Faculty:** We cover color theory.');
    expect(md).toContain('**Auditor:** How is it assessed?');
    expect(md).not.toContain('You are an auditor.');
    expect(md).not.toContain('{"x":1}');
  });

  it('degrades to a placeholder when there are no turns', () => {
    const md = transcriptToOkfMarkdown([], meta);
    expect(md).toMatch(/^type: transcript$/m);
    expect(md).toMatch(/no linked transcript/i);
  });
});
