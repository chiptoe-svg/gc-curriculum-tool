import type { AIProvider } from './provider';

type FakeResponse = unknown;

export class FakeProvider implements AIProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  private responses: FakeResponse[];
  private callCount = 0;

  constructor(responses: FakeResponse[]) {
    this.responses = responses;
  }

  async complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
  }): Promise<{ data: T; costUsdCents: number; durationMs: number }> {
    const idx = this.callCount++;
    if (idx >= this.responses.length) {
      throw new Error(`FakeProvider exhausted at call ${idx}`);
    }
    const data = args.validate(this.responses[idx]);
    return { data, costUsdCents: 5, durationMs: 10 };
  }

  reset() {
    this.callCount = 0;
  }
}
