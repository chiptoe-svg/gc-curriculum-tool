import OpenAI from 'openai';
import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';

export class LocalProvider implements AIProvider {
  readonly name = 'local' as const;
  readonly model: string;
  private client: OpenAI;

  constructor(model: string, baseURL: string) {
    this.model = model;
    // OpenAI SDK requires a non-empty apiKey, but local servers don't validate it.
    this.client = new OpenAI({ apiKey: 'local', baseURL });
  }

  async complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    documents?: Array<{ bytes: Buffer; mimeType: string }>;
  }): Promise<{ data: T } & CompletionTelemetry> {
    const started = Date.now();

    // Append schema to system prompt — local models don't support strict json_schema
    // mode, but they follow schema instructions reliably at 27B+ parameter scale.
    const systemWithSchema =
      `${args.systemPrompt}\n\nRespond with valid JSON that matches this schema:\n` +
      JSON.stringify(args.jsonSchema, null, 2);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemWithSchema },
        { role: 'user', content: args.userMessage },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });
    const durationMs = Date.now() - started;

    const content = response.choices[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Local model returned non-JSON: ${content.slice(0, 200)}`);
    }
    const data = args.validate(parsed);

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;

    return {
      data,
      costUsdCents: 0,
      durationMs,
      cachedTokens: 0,
      uncachedPromptTokens: promptTokens,
      completionTokens,
    };
  }

  // Local text-generation models cannot process raw PDF/DOCX bytes.
  // The extract-text caller wraps this in try/catch and returns status:'failed'.
  async transcribeDocument(_args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult> {
    throw new Error(
      'Local provider does not support document vision transcription. ' +
      'Set AI_PROVIDER=openai for image-based PDF ingestion.',
    );
  }
}
