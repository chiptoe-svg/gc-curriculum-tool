/**
 * The endpoint the Pi interview loop calls, from the interview's role routing
 * (Part 2): an OpenAI model through the RCD gateway, or a campus model with its
 * reasoning level. Pi talks to the endpoint itself (no AIProvider).
 */
import { resolveForFunction } from '@/lib/ai/function-settings';
import { usesResponsesApi } from '@/lib/ai/models';
import { openAIBaseURL } from '@/lib/ai/openai-base-url';
import type { CampusReasoning } from '@/lib/ai/campus';
import type { PiEndpoint } from './turn';

export async function piEndpointFor(): Promise<PiEndpoint> {
  const r = await resolveForFunction('capture-chat-agent');
  if (r.provider === 'campus') {
    const baseUrl = process.env.CAMPUS_LLM_BASE_URL?.trim();
    const apiKey = process.env.CAMPUS_LLM_API_KEY?.trim();
    if (!baseUrl || !apiKey) throw new Error('CAMPUS_LLM_BASE_URL / CAMPUS_LLM_API_KEY not set');
    return { baseUrl, apiKey, model: r.model, api: 'openai-completions', campusReasoning: r.effort as CampusReasoning | undefined };
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  return {
    baseUrl: openAIBaseURL() ?? 'https://api.openai.com/v1',
    apiKey,
    model: r.model,
    api: usesResponsesApi(r.model) ? 'openai-responses' : 'openai-completions',
    reasoning: r.effort as 'low' | 'medium' | 'high' | undefined,
  };
}
