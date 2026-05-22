import Anthropic from '@anthropic-ai/sdk';
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
  const systemPrompt = await loadPrompt('kud-chat');
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = history.length === 0
    ? [{ role: 'user', content: buildKudChatUserMessage(profile) }]
    : history.map((msg) => ({ role: msg.role, content: msg.content }));

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text block in Anthropic response');
  }

  return textBlock.text;
}
