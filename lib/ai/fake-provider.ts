import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';
import type { ToolDefinition, ToolCall, Message, CompleteWithToolsResult } from './tool-use-types';

type FakeResponse = unknown;

/** One step in a scripted tool-use sequence (internal to FakeProvider). */
interface FakeToolUseStep {
  kind: 'response' | 'tool_calls';
  value?: unknown;
  calls?: ToolCall[];
}

/** Options object form of the FakeProvider constructor (used by tool-use tests). */
interface FakeProviderOpts {
  responses?: FakeResponse[];
  transcribeResponses?: string[];
  toolUseScript?: FakeToolUseStep[];
}

export class FakeProvider implements AIProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  private responses: FakeResponse[];
  private callCount = 0;
  private transcribeResponses: string[];
  private transcribeCallCount = 0;
  private toolUseScript: FakeToolUseStep[] = [];

  constructor(responsesOrOpts: FakeResponse[] | FakeProviderOpts = [], transcribeResponses: string[] = []) {
    if (Array.isArray(responsesOrOpts)) {
      // Legacy positional form: new FakeProvider([...responses], [...transcribeResponses])
      this.responses = responsesOrOpts;
      this.transcribeResponses = transcribeResponses;
    } else {
      // Opts object form: new FakeProvider({ toolUseScript, responses, transcribeResponses })
      this.responses = responsesOrOpts.responses ?? [];
      this.transcribeResponses = responsesOrOpts.transcribeResponses ?? transcribeResponses;
      if (responsesOrOpts.toolUseScript) {
        this.toolUseScript = [...responsesOrOpts.toolUseScript];
      }
    }
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

  async completeWithTools<T>(args: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    maxToolCalls?: number;
  }): Promise<CompleteWithToolsResult<T>> {
    const budget = args.maxToolCalls ?? 4;
    const toolCallsUsed: ToolCall[] = [];
    const script = [...this.toolUseScript];

    while (script.length > 0) {
      const step = script.shift()!;
      if (step.kind === 'response') {
        const value = args.validate(step.value);
        return {
          kind: 'response',
          value,
          toolCallsUsed,
          telemetry: { costUsdCents: 0, durationMs: 0, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
        };
      }
      // step.kind === 'tool_calls': execute each, append to toolCallsUsed, continue
      if (!step.calls) continue;
      for (const call of step.calls) {
        if (toolCallsUsed.length >= budget) {
          throw new Error(`FakeProvider: tool-call budget (${budget}) exceeded`);
        }
        const tool = args.tools.find(t => t.name === call.toolName);
        if (!tool) {
          throw new Error(`FakeProvider: scripted tool call references unknown tool: ${call.toolName}`);
        }
        tool.inputSchema.parse(call.args);
        await tool.execute(call.args);
        toolCallsUsed.push(call);
      }
    }
    throw new Error('FakeProvider: toolUseScript exhausted without a response step');
  }

  reset() {
    this.callCount = 0;
    this.transcribeCallCount = 0;
  }
}
