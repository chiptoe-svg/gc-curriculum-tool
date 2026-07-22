/**
 * Base URL for the OpenAI SDK client.
 *
 * Clemson RCD consolidated hosted-model + OpenAI access behind one API key and
 * an OpenAI-compatible proxy (`https://llm.rcd.clemson.edu/openai/v1`). Set
 * `OPENAI_BASE_URL` to route all OpenAI calls (chat, models, whisper) through
 * that proxy with the campus key. Unset ⇒ `undefined` ⇒ the SDK default
 * (`api.openai.com`), so nothing changes for a plain OpenAI deployment.
 *
 * Passed as `new OpenAI({ apiKey, baseURL: openAIBaseURL() })` — a `baseURL` of
 * `undefined` is ignored by the SDK, so every call site can pass it
 * unconditionally.
 */
export function openAIBaseURL(): string | undefined {
  return process.env.OPENAI_BASE_URL?.trim() || undefined;
}
