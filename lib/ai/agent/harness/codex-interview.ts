/**
 * Interviewer turn on Codex (codex exec), harness spike 2026-10-28.
 *
 * Per turn, in a fresh temp dir (deleted afterwards):
 *   - CODEX_HOME/config.toml: the RCD provider (Responses API), the model and
 *     effort, our system prompt replacing Codex's built-in instructions
 *     (model_instructions_file), the shell tool off, web search off, our tools
 *     as an MCP server (scripts/capture/harness-mcp-server.ts, scratch DB only),
 *     and two hooks (scripts/capture/harness-codex-hook.ts): Stop runs the
 *     controls, PreToolUse enforces the tool budget;
 *   - the conversation is rendered into the prompt (codex exec starts a new
 *     thread; production would resume one thread per interview instead);
 *   - --output-schema holds the reply to the AuditResponse schema.
 * The API key reaches Codex through its env (env_key), never argv or the file.
 * Its tools run in the MCP server process, so the chunk ids they returned come
 * back in retrievedChunkIds for scoring.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuditResponseJsonSchema, AuditResponseSchema } from '@/lib/ai/agent/audit-response-schema';
import type { ToolCall } from '@/lib/ai/tool-use-types';
import { citableFromHistory, needsMaterialSearch, previousQuestion } from './controls';
import type { LoopTurnInput, LoopTurnResult } from './pi-interview';

const ROOT = process.cwd();
const TSX = path.join(ROOT, 'node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs');
const CODEX = path.join(ROOT, 'node_modules/.bin/codex');
const toml = (s: string) => JSON.stringify(s); // TOML basic strings accept JSON-style escapes

function renderPrompt(input: LoopTurnInput): string {
  const [context, ...rest] = input.messages;
  const last = rest.pop();
  const transcript = rest.map(m => m.role === 'user' ? `[Instructor] ${m.content}` : m.role === 'assistant' ? `[Interviewer] ${m.content ?? ''}` : '').filter(Boolean).join('\n\n');
  return [
    context && context.role === 'user' ? context.content : '',
    '# Conversation so far\n\n' + (transcript || '(none)'),
    '# The instructor\'s new message\n\n' + (last && last.role === 'user' ? last.content : ''),
    'Respond with the structured per-turn response.',
  ].join('\n\n');
}

export async function runCodexTurn(input: LoopTurnInput): Promise<LoopTurnResult & { retrievedChunkIds: string[] }> {
  const started = Date.now();
  const ep = input.endpoint;
  const course = input.courseCode;
  if (!course) throw new Error('codex: courseCode is required');
  if (!process.env.DATABASE_URL?.includes('scratch')) throw new Error('codex: refusing, DATABASE_URL must name a scratch database');

  const dir = mkdtempSync(path.join(tmpdir(), 'codex-turn-'));
  const home = path.join(dir, 'home'); const work = path.join(dir, 'work');
  mkdirSync(home); mkdirSync(work);
  try {
    const maxToolCalls = input.maxToolCalls ?? 4;
    const history = citableFromHistory(input.messages as Array<{ role: string; content: string | null }>);
    writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
      controls: input.controls, maxToolCalls,
      searchRule: input.controls ? needsMaterialSearch(input.userMessage, input.fileNames, previousQuestion(input.messages as Array<{ role: string; content: string | null }>)) : { required: false },
      history: { messageIds: [...history.messageIds], chunkIds: [...history.chunkIds] },
    }));
    writeFileSync(path.join(dir, 'instructions.md'), input.systemPrompt);
    writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(AuditResponseJsonSchema));
    const hook = (mode: string) => [process.execPath, TSX, path.join(ROOT, 'scripts/capture/harness-codex-hook.ts'), mode, dir].map(a => `'${a}'`).join(' ');
    writeFileSync(path.join(home, 'config.toml'), [
      `model = ${toml(ep.model)}`,
      `model_provider = "rcd"`,
      ep.reasoning ? `model_reasoning_effort = ${toml(ep.reasoning)}` : '',
      `model_instructions_file = ${toml(path.join(dir, 'instructions.md'))}`,
      `web_search = "disabled"`,
      `[features]`, `shell_tool = false`,
      `[model_providers.rcd]`, `name = "RCD"`, `base_url = ${toml(ep.baseUrl)}`, `env_key = "RCD_SPIKE_KEY"`, `wire_api = "responses"`,
      `[mcp_servers.capture]`,
      // exec runs with approval policy "never", so an MCP call that needs approval is refused
      // ("MCP tool call requires approval, but approval policy is never"). Pre-approve this
      // server only: its tools are our own read-only interview tools.
      `default_tools_approval_mode = "approve"`,
      `command = ${toml(process.execPath)}`,
      `args = [${toml(TSX)}, ${toml(path.join(ROOT, 'scripts/capture/harness-mcp-server.ts'))}]`,
      `cwd = ${toml(ROOT)}`,
      `startup_timeout_sec = 60`, `tool_timeout_sec = 120`,
      `[mcp_servers.capture.env]`,
      `HARNESS_COURSE = ${toml(course)}`, `HARNESS_LOG = ${toml(path.join(dir, 'log.jsonl'))}`, `DATABASE_URL = ${toml(process.env.DATABASE_URL)}`,
      `[[hooks.Stop]]`, `[[hooks.Stop.hooks]]`, `type = "command"`, `command = ${toml(hook('stop'))}`, `timeout = 60`,
      `[[hooks.PreToolUse]]`, `matcher = "mcp__capture__.*"`, `[[hooks.PreToolUse.hooks]]`, `type = "command"`, `command = ${toml(hook('pretool'))}`, `timeout = 60`,
    ].filter(Boolean).join('\n') + '\n');

    const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only',
      '--output-schema', path.join(dir, 'schema.json'), '-o', path.join(dir, 'out.json'), '-C', work, '-'];
    const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const p = spawn(CODEX, args, { env: { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: home, RCD_SPIKE_KEY: ep.apiKey } as unknown as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '';
      const timer = setTimeout(() => p.kill('SIGTERM'), 600000);
      p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
      p.on('error', reject);
      p.on('close', c => { clearTimeout(timer); resolve({ stdout: out, stderr: err, code: c }); });
      p.stdin.end(renderPrompt(input));
    });

    let uncached = 0, cached = 0, outTok = 0, turns = 0;
    const errors: string[] = [];
    for (const line of stdout.split('\n').filter(Boolean)) {
      let e: { type?: string; usage?: Record<string, number>; item?: { type?: string; message?: string }; message?: string; error?: { message?: string } };
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === 'turn.completed' && e.usage) {
        turns++;
        cached += e.usage.cached_input_tokens ?? 0;
        uncached += (e.usage.input_tokens ?? 0) - (e.usage.cached_input_tokens ?? 0); // Codex input is cache-inclusive
        outTok += e.usage.output_tokens ?? 0;
      }
      if (e.type === 'turn.failed') errors.push(e.error?.message ?? e.message ?? JSON.stringify(e));
      if (e.item?.type === 'error' && !/Model metadata/.test(e.item.message ?? '')) errors.push(e.item.message ?? '');
    }
    if (process.env.HARNESS_KEEP) { writeFileSync(path.join(dir, 'stdout.jsonl'), stdout); writeFileSync(path.join(dir, 'stderr.txt'), stderr); console.error(`[codex] kept ${dir}`); }
    if (process.env.HARNESS_TRACE) console.error(`[codex] exit ${code}; ${errors.join(' | ').slice(0, 400)}\n${stderr.slice(-600)}`);
    const outPath = path.join(dir, 'out.json');
    if (!existsSync(outPath)) throw new Error(`codex: no reply (exit ${code}) ${errors.join(' | ').slice(0, 300)} ${stderr.slice(-300)}`);
    const value = AuditResponseSchema.parse(JSON.parse(readFileSync(outPath, 'utf8')));
    const logPath = path.join(dir, 'log.jsonl');
    const calls = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { tool: string; args: Record<string, unknown>; chunkIds: string[] }) : [];
    const toolCallsUsed: ToolCall[] = calls.map((c, i) => ({ id: `codex-${i}`, toolName: c.tool, args: c.args }));
    const eventsPath = path.join(dir, 'events.jsonl');
    const controlEvents = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as string) : [];
    return {
      value, toolCallsUsed, controlEvents, requests: turns,
      retrievedChunkIds: calls.flatMap(c => c.chunkIds),
      telemetry: { costUsdCents: 0, durationMs: Date.now() - started, cachedTokens: cached, uncachedPromptTokens: uncached, completionTokens: outTok },
    };
  } finally {
    if (!process.env.HARNESS_KEEP) rmSync(dir, { recursive: true, force: true });
  }
}
