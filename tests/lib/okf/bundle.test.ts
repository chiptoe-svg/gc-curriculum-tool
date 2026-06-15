import { describe, it, expect } from 'vitest';
import * as yauzl from 'yauzl';
import { buildOkfBundle } from '@/lib/okf/bundle';

function listEntries(buf: Buffer): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('no zip'));
      const out: Record<string, string> = {};
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error('no stream'));
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => { out[entry.fileName] = Buffer.concat(chunks).toString('utf8'); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolve(out));
      zip.readEntry();
    });
  });
}

const input = {
  course: { code: 'GC 2400', title: 'Intro', prefix: 'GC', level: 2400, track: null, buildsToCareer: false, catalogUrl: null },
  profile: { scale_version: 'v1', overview: 'A course.', competencies: [], revised_objectives_draft: [], incoming_expectations: [] } as any,
  snapshot: { id: 'snap-1', createdAt: new Date('2026-06-15T00:00:00.000Z'), instructorName: 'Dr. X' },
  viewUrl: 'http://h/view/GC%202400',
  transcriptMessages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }],
  materials: [
    { fileName: 'Reading.pdf', extractedText: 'text', ignored: false, mimeType: 'application/pdf', uploadedAt: new Date('2026-06-15T00:00:00.000Z') },
    { fileName: 'Empty.pdf', extractedText: null, ignored: false, mimeType: 'application/pdf', uploadedAt: new Date('2026-06-15T00:00:00.000Z') },
  ],
};

describe('buildOkfBundle', () => {
  it('zips index/profile/transcript and one file per material with text', async () => {
    const buf = await buildOkfBundle(input);
    const entries = await listEntries(buf);
    const names = Object.keys(entries).sort();
    expect(names).toContain('index.md');
    expect(names).toContain('profile.md');
    expect(names).toContain('transcript.md');
    expect(names).toContain('materials/reading-pdf.md');
    expect(names).not.toContain('materials/empty-pdf.md');
    expect(entries['index.md']).toContain('Empty.pdf');
    expect(entries['index.md']).toMatch(/snap-1/);
    expect(entries['profile.md']).toMatch(/^type: course$/m);
    expect(entries['transcript.md']).toContain('**Faculty:** Hi');
  });
});
