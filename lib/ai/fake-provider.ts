import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';

type FakeResponse = unknown;

export class FakeProvider implements AIProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  private responses: FakeResponse[];
  private callCount = 0;
  private transcribeResponses: string[];
  private transcribeCallCount = 0;

  constructor(responses: FakeResponse[], transcribeResponses: string[] = []) {
    this.responses = responses;
    this.transcribeResponses = transcribeResponses;
  }

  async complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    documents?: Array<{ bytes: Buffer; mimeType: string }>;
  }): Promise<{ data: T } & CompletionTelemetry> {
    const idx = this.callCount++;
    if (idx >= this.responses.length) {
      throw new Error(`FakeProvider exhausted at call ${idx}`);
    }
    const data = args.validate(this.responses[idx]);
    return { data, costUsdCents: 5, durationMs: 10, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 };
  }

  async transcribeDocument(_args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult> {
    const idx = this.transcribeCallCount++;
    const text = this.transcribeResponses[idx] ?? '';
    return { text, costUsdCents: 10, truncated: false };
  }

  reset() {
    this.callCount = 0;
    this.transcribeCallCount = 0;
  }
}
