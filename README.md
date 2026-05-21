# OpenGate

**MCP Security Gateway for AI Agents**

OpenGate is an open-source security proxy that sits between AI agent clients (Claude Code, Cursor, Gemini CLI, etc.) and MCP servers. It intercepts every tool call, evaluates declarative security policies, and logs audit trails — giving you control over what your AI agents can do.

```
MCP Client (Claude Code / Cursor / Any Agent)
    │ stdin/stdout (JSON-RPC)
    ▼
┌─────────────────────────────┐
│  OpenGate                   │
│  ┌───────────────────────┐  │
│  │ Policy Engine         │  │  ← opengate.yaml
│  │ - glob/regex matching │  │
│  │ - argument filtering  │  │
│  │ - rate limiting       │  │
│  │ - approval flow       │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ Audit Logger          │  │  → audit.jsonl
│  └───────────────────────┘  │
└─────────────────────────────┘
    │ spawn + stdin/stdout
    ▼
Real MCP Server (child process)
```

## Why OpenGate?

The MCP protocol has **no per-tool authorization**. Tool annotations (`readOnlyHint`, `destructiveHint`) are self-declared by servers and explicitly untrusted. Existing security tools cover only one layer:

| Tool | What it does | What it misses |
|------|-------------|----------------|
| AgentShield | Static config scanning | No runtime enforcement |
| Agentic Security | LLM red-teaming | No agent-level policies |
| CUA / Agent Sandbox | Sandboxing | No policy engine |

**OpenGate fills the gap**: runtime per-tool-call policy enforcement, framework-agnostic, via standard MCP protocol.

## Quick Start

### Install

```bash
npm install -g @opengate/cli
```

### Generate a default policy

```bash
opengate init
```

This creates `opengate.yaml` with example rules.

### Create a server config

Create `opengate-filesystem.yaml`:

```yaml
policy: ./opengate.yaml
server:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-filesystem"
    - "/path/to/your/project"
```

### Point your MCP client to OpenGate

In Claude Code's `settings.json` (or MCP config):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "opengate",
      "args": ["--config", "./opengate-filesystem.yaml"]
    }
  }
}
```

That's it. Every tool call now goes through OpenGate's policy engine.

## Policy Reference

Policies are defined in YAML. Rules are evaluated top-to-bottom; first match wins.

```yaml
version: "1"
name: "my-policy"
default: deny          # "allow" or "deny" when no rule matches

settings:
  rateLimit:
    window: 60         # seconds
    maxCalls: 100      # per tool per window
  audit:
    enabled: true
    path: "./audit.jsonl"
    format: jsonl

rules:
  # Allow read-only tools
  - id: "allow-read-only"
    match:
      tool:
        annotations:
          readOnlyHint: true
    action: allow

  # Block destructive shell commands
  - id: "block-rm-rf"
    match:
      tool:
        name: "Bash"
        arguments:
          command:
            regex: "rm\\s+-rf|mkfs|dd\\s+if="
    action: block
    reason: "Destructive command detected"

  # Rate limit GitHub API
  - id: "github-rate-limit"
    match:
      server: "github"
      tool:
        name: "*"
    action: allow
    rateLimit:
      window: 60
      maxCalls: 30

  # Require approval for deletions
  - id: "approve-deletions"
    match:
      tool:
        name:
          regex: ".*delete.*|.*remove.*"
    action: require-approval
    approval:
      timeout: 30
```

### Match Types

**Tool name matching:**

| Type | Example | Matches |
|------|---------|---------|
| Exact | `"Bash"` | Only "Bash" |
| Glob | `"filesystem/*"` | "filesystem/read", "filesystem/write" |
| Regex | `{ regex: ".*delete.*" }` | Any name containing "delete" |

**Argument matching:**

| Operator | Example | Description |
|----------|---------|-------------|
| `startsWith` | `{ startsWith: "/safe/" }` | String prefix |
| `endsWith` | `{ endsWith: ".js" }` | String suffix |
| `contains` | `{ contains: "password" }` | Substring |
| `regex` | `{ regex: "rm\\s+-rf" }` | Regular expression |
| `equals` | `{ equals: "admin" }` | Exact match |
| `in` | `{ in: ["rm", "rmdir"] }` | Value in set |
| `not` | `{ not: { startsWith: "/unsafe/" } }` | Negation |

### Actions

| Action | Behavior |
|--------|----------|
| `allow` | Forward the tool call to the server |
| `block` | Reject immediately with an error message |
| `require-approval` | Prompt the user in terminal before proceeding |

## Audit Logging

Every tool call is logged with:

```json
{
  "timestamp": "2026-05-21T12:00:00.000Z",
  "serverName": "filesystem",
  "toolName": "write_file",
  "arguments": { "path": "/tmp/test.txt" },
  "decision": "allowed",
  "matchedRule": "allow-writes",
  "reason": "Matched rule 'allow-writes'",
  "durationMs": 42,
  "resultSummary": "File written successfully"
}
```

View logs:

```bash
cat audit.jsonl | jq .
```

## CLI Reference

```
opengate [command] [options]

Commands:
  start    Start the MCP security proxy (default)
  init     Generate a default policy file

Options (start):
  -c, --config <path>         Config YAML (policy + server definition)
  -p, --policy <path>         Policy YAML file
  --server-command <cmd>      MCP server command to proxy
  --server-args <args>        Comma-separated server arguments
  --audit-log <path>          Audit log output path
  -v, --verbose               Log to stderr

Options (init):
  -o, --output <path>         Output path (default: opengate.yaml)
```

## Architecture

OpenGate intercepts at the **MCP application layer** using the official MCP SDK:

1. Spawns the real MCP server as a child process
2. Discovers all tools via `tools/list`
3. Registers each tool on a proxy `McpServer`
4. On each `tools/call`, evaluates the policy engine before forwarding
5. Logs every decision to the audit trail

This makes OpenGate transparent to both client and server — neither needs to know it's there.

## Development

```bash
git clone https://github.com/ymstar/opengate.git
cd opengate
npm install
npm run build
npm test
```

## License

MIT
