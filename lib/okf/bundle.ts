import { ZipFile } from 'yazl';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { profileToOkfMarkdown } from '@/lib/okf/profile-to-okf';
import { materialToOkfMarkdown, type OkfMaterialInput } from '@/lib/okf/material-to-okf';
import { transcriptToOkfMarkdown, type OkfTranscriptMessage } from '@/lib/okf/transcript-to-okf';
import { okfDocument } from '@/lib/okf/okf-doc';
import { safeFilename } from '@/lib/storage/local-storage';

export interface OkfBundleInput {
  course: {
    code: string; title: string; prefix?: string; level?: number | null;
    track?: string | null; buildsToCareer?: boolean; catalogUrl?: string | null;
  };
  profile: CaptureProfile;        // already PII-redacted by the caller
  snapshot: { id: string; createdAt: Date | string; instructorName: string | null };
  viewUrl: string;
  transcriptMessages: OkfTranscriptMessage[]; // already PII-redacted by the caller
  materials: OkfMaterialInput[];
}

function courseSlug(code: string): string {
  return code.toLowerCase().replace(/\s+/g, '-');
}

/** Resolve material-entry-name collisions (two files slugging to the same name). */
function uniqueName(used: Set<string>, base: string): string {
  let name = base;
  let n = 2;
  while (used.has(name)) { name = base.replace(/\.md$/, `-${n}.md`); n++; }
  used.add(name);
  return name;
}

/**
 * Assemble the single-course OKF bundle and return a .zip as a Buffer.
 * Entries: index.md, profile.md, transcript.md, materials/<name>.md (one per
 * material with extracted text). Pure of DB/AI - takes already-loaded,
 * already-redacted data.
 */
export async function buildOkfBundle(input: OkfBundleInput): Promise<Buffer> {
  const slug = courseSlug(input.course.code);
  const createdIso = (input.snapshot.createdAt instanceof Date
    ? input.snapshot.createdAt : new Date(input.snapshot.createdAt)).toISOString();

  const files: Array<{ name: string; content: string }> = [];

  files.push({
    name: 'profile.md',
    content: profileToOkfMarkdown({
      course: input.course,
      profile: input.profile,
      snapshot: { id: input.snapshot.id, createdAt: input.snapshot.createdAt, instructorName: input.snapshot.instructorName },
      viewUrl: input.viewUrl,
    }),
  });

  files.push({
    name: 'transcript.md',
    content: transcriptToOkfMarkdown(input.transcriptMessages, {
      courseCode: input.course.code,
      courseTitle: input.course.title,
      slug,
      timestamp: createdIso,
      resource: input.viewUrl,
    }),
  });

  const used = new Set<string>();
  const manifestMaterials: string[] = [];
  for (const m of input.materials) {
    if (m.extractedText && m.extractedText.trim()) {
      const name = uniqueName(used, `materials/${safeFilename(m.fileName).toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}.md`);
      files.push({ name, content: materialToOkfMarkdown(m, { resource: input.viewUrl }) });
      manifestMaterials.push(`- \`${name}\` — ${m.fileName}${m.ignored ? ' (set aside)' : ''}`);
    } else {
      manifestMaterials.push(`- ${m.fileName} — _(not extracted; no file)_`);
    }
  }

  const indexBody = [
    `# ${input.course.code} — ${input.course.title}`,
    '',
    'Self-contained OKF export of one captured course. Every file is OKF markdown — open in any editor or hand to a tool/agent.',
    '',
    `- **Snapshot:** ${input.snapshot.id} · ${createdIso}`,
    `- **Instructor:** ${input.snapshot.instructorName ?? 'Department canonical'}`,
    `- **Source:** ${input.viewUrl}`,
    '',
    '## Contents',
    '- `profile.md` — OKF course profile (competencies, K/U/D depths, evidence, citations)',
    '- `transcript.md` — the capture interview',
    '### Materials',
    ...manifestMaterials,
    '',
    '> Depth scale: 0 not present · 1 exposure · 2 recognize · 3 recall · 4 transfer · 5 fluent.',
  ].join('\n');

  files.push({
    name: 'index.md',
    content: okfDocument(
      {
        type: 'bundle',
        title: `${input.course.code} — OKF bundle`,
        description: `Self-contained capture export for ${input.course.title}`,
        slug: `${slug}-bundle`,
        tags: ['bundle'],
        timestamp: createdIso,
        resource: input.viewUrl,
        extra: { snapshot_id: input.snapshot.id },
      },
      indexBody,
    ),
  });

  const zip = new ZipFile();
  for (const f of files) zip.addBuffer(Buffer.from(f.content, 'utf8'), f.name);
  zip.end();

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve());
    zip.outputStream.on('error', reject);
  });
  return Buffer.concat(chunks);
}
