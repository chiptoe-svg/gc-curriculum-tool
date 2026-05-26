import OpenAI from 'openai';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { resolveModelForFunction } from '@/lib/ai/function-settings';

export interface SummarizeInput {
  fileName: string;
  extractedText: string;
}

export interface SummarizeResult {
  digest: string;
  model: string;
}

export async function summarizeMaterial(input: SummarizeInput): Promise<SummarizeResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const client = new OpenAI({ apiKey });

  const model = await resolveModelForFunction('material-summary');
  const systemPrompt = await loadPrompt('material-summary');

  const userMessage = [
    `File name: ${input.fileName}`,
    '',
    'Material content begins:',
    '---',
    input.extractedText,
    '---',
    'End of material content.',
  ].join('\n');

  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  const digest = response.choices[0]?.message?.content;
  if (!digest) throw new Error('No content in summarizer response');
  return { digest, model };
}
