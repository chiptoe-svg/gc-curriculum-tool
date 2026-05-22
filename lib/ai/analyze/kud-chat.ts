import OpenAI from 'openai';
import { loadPrompt } from '@/lib/ai/prompts/load';

export interface KudChatProfile {
  title: string;
  description: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function buildKudChatUserMessage(profile: KudChatProfile): string {
  const objLines = profile.learningObjectives.length > 0
    ? profile.learningObjectives.map((o, i) => `${i + 1}. ${o}`)
    : ['(none)'];
  const projLines = profile.majorProjects.length > 0
    ? profile.majorProjects.map((p, i) => `${i + 1}. ${p}`)
    : ['(none)'];
  const skillLines = profile.skillsRequired.length > 0
    ? profile.skillsRequired.map((s, i) => `${i + 1}. ${s}`)
    : ['(none)'];

  const parts = [
    `**Course:** ${profile.title}`,
    `**Description:** ${profile.description || '(none)'}`,
    '',
    '**Learning objectives:**',
    ...objLines,
    '',
    '**Major projects:**',
    ...projLines,
    '',
    '**Required incoming skills:**',
    ...skillLines,
  ];

  return parts.join('\n');
}

export async function kudChatTurn(
  profile: KudChatProfile,
  history: ChatMessage[],
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const client = new OpenAI({ apiKey });

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o';

  const systemPrompt = await loadPrompt('kud-chat');

  const openaiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...(history.length === 0
      ? [{ role: 'user' as const, content: buildKudChatUserMessage(profile) }]
      : history.map(m => ({ role: m.role, content: m.content }))),
  ];

  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    messages: openaiMessages,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No content in OpenAI chat response');
  return content;
}
