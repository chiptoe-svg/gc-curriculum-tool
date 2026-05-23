import OpenAI from 'openai';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { baselineFoundationalCompetencies, type CaptureProfile } from '@/lib/ai/capture/schema';

/**
 * Multi-turn chat helper for the CourseCapture audit conversation.
 *
 * The first turn pre-loads the user message with the full course context
 * (catalog, profile, syllabus, Canvas assignments, uploaded materials, any
 * prior capture profile). Subsequent turns pass the running history.
 *
 * No token budget is enforced in v1 — full material text is dumped into the
 * context. If a model rejects on size, we'll see it surface and trim then.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CaptureChatMaterial {
  id: string;
  fileName: string;
  extractionStatus: string;
  extractedText: string | null;
}

export interface PrerequisiteCaptureProfile {
  code: string;
  title: string;
  profile: CaptureProfile;
  reviewerStatus: string;
}

export interface CaptureChatContext {
  course: {
    code: string;
    title: string;
    description: string;
    prerequisites: string;
    learningObjectives: string[];
    majorProjects: string[];
    skillsRequired: string[];
  };
  /**
   * Course Builder profile (the prior AI-synthesized profile, if any). Distinct
   * from `priorCaptureProfile`, which is the prior depth-rating output.
   */
  builderProfile: {
    summary: string;
    learningObjectives: string[];
    skills: string[];
    competencies: Array<{
      name: string;
      description: string;
      level: string;
      evidence: Array<{ fileName: string; quote: string }>;
    }>;
  } | null;
  materials: CaptureChatMaterial[];
  priorCaptureProfile: CaptureProfile | null;
  /**
   * Course Outcome Profiles for any prerequisite courses that have already
   * been captured. The auditor treats these as authoritative evidence of
   * what students arrive with, so prereq sufficiency can be evaluated
   * concretely instead of asking the instructor to recall.
   */
  prerequisiteCaptureProfiles: PrerequisiteCaptureProfile[];
}

function formatList(label: string, items: string[]): string {
  if (items.length === 0) return `${label}\n(none provided)`;
  return [label, ...items.map((it, i) => `${i + 1}. ${it}`)].join('\n');
}

function formatMaterials(materials: CaptureChatMaterial[]): string {
  if (materials.length === 0) return '**Uploaded and Canvas-imported materials:**\n(none)';
  const sections: string[] = ['**Uploaded and Canvas-imported materials:**'];
  for (const m of materials) {
    const header = `### ${m.fileName} [status: ${m.extractionStatus}]`;
    const body = m.extractedText && m.extractedText.length > 0
      ? m.extractedText
      : '(no extracted text available)';
    sections.push(header, body, '');
  }
  return sections.join('\n');
}

function formatPriorCaptureProfile(prior: CaptureProfile | null): string {
  if (!prior) return '**Prior capture profile for this course:** (none)';
  return [
    '**Prior capture profile for this course:**',
    `Scale version: ${prior.scale_version}`,
    `Generated at: ${prior.generated_at}`,
    '',
    'Competencies:',
    ...prior.competencies.map(c =>
      `- [${c.type}] ${c.statement} (K=${c.k_depth ?? '—'}, U=${c.u_depth ?? '—'}, D=${c.d_depth})`,
    ),
  ].join('\n');
}

function formatPrereqCaptureProfiles(profiles: PrerequisiteCaptureProfile[]): string {
  if (profiles.length === 0) {
    return [
      '**Prerequisite courses with confirmed Course Outcome Profiles:** (none)',
      '',
      'No prerequisite course has been captured yet, so what students arrive',
      'with must be inferred from the instructor\'s replies and the catalog',
      'prereq language. Be explicit about this uncertainty in the conversation.',
    ].join('\n');
  }
  const sections: string[] = [
    '**Prerequisite courses with confirmed Course Outcome Profiles:**',
    '',
    'These profiles describe what students who took the prereq actually',
    'developed, scored on the K/U/D depth scale. Use them as authoritative',
    'evidence of what students arrive with — you do not need to ask the',
    'instructor to recall what each prereq produces when it is documented here.',
    '',
  ];
  for (const p of profiles) {
    sections.push(`### ${p.code} — ${p.title} (reviewer status: ${p.reviewerStatus})`);
    for (const c of p.profile.competencies) {
      const k = c.k_depth ?? '—';
      const u = c.u_depth ?? '—';
      sections.push(
        `- [${c.type}] ${c.statement} (K=${k}, U=${u}, D=${c.d_depth})`
        + (c.rationale ? `\n  · ${c.rationale}` : ''),
      );
    }
    sections.push('');
  }
  return sections.join('\n');
}

function formatBuilderProfile(profile: CaptureChatContext['builderProfile']): string {
  if (!profile) return '**Course Builder profile:** (none — this course has no synthesized profile yet)';
  const competencyLines = profile.competencies.map(c =>
    `- ${c.name} [${c.level}]: ${c.description}`,
  );
  return [
    '**Course Builder profile (from the Materials tab analysis):**',
    `Summary: ${profile.summary}`,
    '',
    formatList('Learning objectives (synthesized):', profile.learningObjectives),
    '',
    formatList('Skills (synthesized):', profile.skills),
    '',
    'Competencies (synthesized):',
    ...(competencyLines.length > 0 ? competencyLines : ['(none)']),
  ].join('\n');
}

export function buildCaptureChatUserMessage(context: CaptureChatContext): string {
  const { course } = context;
  const parts: string[] = [
    `**Course:** ${course.code} — ${course.title}`,
    `**Description:** ${course.description || '(none)'}`,
    `**Prerequisites (catalog):** ${course.prerequisites || '(none listed)'}`,
    '',
    formatList('**Catalog learning objectives:**', course.learningObjectives),
    '',
    formatList('**Catalog major projects:**', course.majorProjects),
    '',
    formatList('**Catalog required incoming skills:**', course.skillsRequired),
    '',
    formatBuilderProfile(context.builderProfile),
    '',
    formatMaterials(context.materials),
    '',
    formatPriorCaptureProfile(context.priorCaptureProfile),
    '',
    formatPrereqCaptureProfiles(context.prerequisiteCaptureProfiles),
    '',
    '---',
    '',
    '**Baseline foundational competencies to score in every session:**',
    ...baselineFoundationalCompetencies.map((c, i) => `${i + 1}. ${c}`),
    '',
    '---',
    '',
    'Begin the audit. Open with a brief summary of what you found in the',
    "materials, the most important gap or contradiction you noticed, and",
    'your first questions. Cite specific evidence (assignment names, rubric',
    'criteria, point values). Do not ask generic questions when you can ask',
    'a specific evidence-grounded one.',
  ];
  return parts.join('\n');
}

export async function captureChatTurn(
  context: CaptureChatContext,
  history: ChatMessage[],
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const client = new OpenAI({ apiKey });

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o';
  const systemPrompt = await loadPrompt('capture-chat');

  const openaiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...(history.length === 0
      ? [{ role: 'user' as const, content: buildCaptureChatUserMessage(context) }]
      : [
          // First user message is always the full context bundle, even on
          // continuation turns. Subsequent history rides on top.
          { role: 'user' as const, content: buildCaptureChatUserMessage(context) },
          ...history.map(m => ({ role: m.role, content: m.content })),
        ]),
  ];

  const response = await client.chat.completions.create({
    model,
    max_completion_tokens: 2048,
    messages: openaiMessages,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No content in OpenAI chat response');
  return content;
}
