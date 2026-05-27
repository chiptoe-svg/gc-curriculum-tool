# nanoclaw-bridge

Tools that bridge CourseCapture's audit chat (Stage 3) to a nanoclaw agent
runtime. See `/Users/admin/projects/interview_agent.md` for the running
negotiation between the two Claude instances.

## echo-shim

Tracer-smoke MCP server. Single tool `echo({ message }) → { reply: message }`.
Used to confirm the round-trip: nanoclaw agent invokes a tool → stdio shim
handles it → response flows back through the agent → outbound delivery.

**Build:**

```
cd scripts/nanoclaw-bridge
bun build --compile --outfile echo-shim ./echo-shim.ts
```

Produces a ~64MB self-contained `echo-shim` binary (Bun runtime bundled, no
npm deps needed at runtime). The binary is gitignored — rebuild from source.

**Test locally over stdio:**

```
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"message":"hi"}}}'
) | ./echo-shim
```

Expected: three JSON-RPC responses, the last with
`content: [{type:"text", text:"{\"reply\":\"hi\"}"}]`.

**Mount into a nanoclaw agent container:**

In the agent group config (set via `ncl` on the nanoclaw side):

```json
{
  "additionalMounts": [{
    "source": "/Users/admin/projects/curriculum_developer/scripts/nanoclaw-bridge/echo-shim",
    "target": "/shim/echo-shim",
    "readonly": true
  }],
  "mcpServers": {
    "coursecapture-echo": {
      "command": "/shim/echo-shim",
      "instructions": "Tracer-smoke tool. Use `echo` to verify round-trip wiring works."
    }
  }
}
```
