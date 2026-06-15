import { okfDocument } from '@/lib/okf/okf-doc';

export interface OkfTranscriptMessage {
  role: string; // 'system' | 'user' | 'assistant' | 'tool'
  content: string | null;
}

export interface OkfTranscriptMeta {
  courseCode: string;
  courseTitle: string;
  slug: string;
  timestamp: string; // ISO (snapshot createdAt)
  resource: string;
}

const ROLE_LABEL: Record<string, string> = { user: 'Faculty', assistant: 'Auditor' };

/**
 * The capture interview turns -> an OKF `type: transcript` markdown file. Only
 * user + assistant turns with text are rendered (system/tool turns and
 * tool-only assistant turns are dropped). Pure - PII redaction is the caller's
 * job (the route redacts before calling).
 */
export function transcriptToOkfMarkdown(
  messages: OkfTranscriptMessage[],
  meta: OkfTranscriptMeta,
): string {
  const turns = messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content && m.content.trim())
    .map(m => `**${ROLE_LABEL[m.role]}:** ${m.content!.trim()}`);
  const body = turns.length
    ? `# ${meta.courseCode} — capture transcript\n\n${turns.join('\n\n')}`
    : `# ${meta.courseCode} — capture transcript\n\n_(This snapshot has no linked transcript.)_`;
  return okfDocument(
    {
      type: 'transcript',
      title: `${meta.courseCode} — capture transcript`,
      description: `Capture interview for ${meta.courseTitle}`,
      slug: `${meta.slug}-transcript`,
      tags: ['transcript'],
      timestamp: meta.timestamp,
      resource: meta.resource,
    },
    body,
  );
}
