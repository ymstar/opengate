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

## Commands

### `opengate init`

Generate a default policy file:

```bash
opengate init                    # creates ./opengate.yaml
opengate init -o my-policy.yaml  # custom output path
```

### `opengate start`

Start the MCP security proxy (default command):

```bash
# Stdio mode (for local MCP servers)
opengate start --config ./opengate-filesystem.yaml

# HTTP mode (for remote MCP servers)
opengate start --transport http --port 4000 --upstream http://server:3000/mcp --policy ./opengate.yaml

# Inline server command
opengate start --server-command npx --server-args "-y,@modelcontextprotocol/server-filesystem,/tmp"
```

### `opengate scan`

Scan MCP configurations for security issues:

```bash
opengate scan                        # auto-detect config directory
opengate scan --target ~/.claude     # specific directory
opengate scan --format json          # JSON output
```

Detects:
- Hardcoded API keys and tokens (GitHub, OpenAI, Anthropic, AWS, Slack)
- Overly permissive tool allowlists
- Unpinned MCP server packages (supply chain risk)
- Unencrypted remote server connections
- Dangerous CLI flags (`--dangerously-skip-permissions`)

### `opengate dashboard`

Launch a web dashboard for audit logs:

```bash
opengate dashboard                           # default port 3939
opengate dashboard --port 8080 --audit-log ./audit.jsonl
```

Features:
- Real-time log streaming (auto-refresh every 5s)
- Decision breakdown (allowed/blocked/approved)
- Top tools by call count
- Full audit log table with filtering

### `opengate hook`

Run as a Claude Code PreToolUse hook (no proxy needed):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "opengate hook --policy ./opengate.yaml"
          }
        ]
      }
    ]
  }
}
```

Exit codes: `0` = allow, `2` = block.

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

### Policy Composition

Policies can inherit from other policies:

```yaml
# strict.yaml
version: "1"
default: deny
rules:
  - id: "allow-read-only"
    match:
      tool:
        annotations:
          readOnlyHint: true
    action: allow

# project.yaml - extends strict.yaml
version: "1"
extends: ./strict.yaml
default: deny
rules:
  - id: "allow-project-writes"
    match:
      tool:
        name: "Write"
        arguments:
          path:
            startsWith: "/my/project/"
    action: allow
```

Import rules from multiple files:

```yaml
version: "1"
default: deny
imports:
  - ./base-rules.yaml
  - ./team-rules.yaml
rules:
  - id: "project-specific"
    match: { tool: { name: "*" } }
    action: allow
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

Every tool call is logged:

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
opengate dashboard  # visual dashboard
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
