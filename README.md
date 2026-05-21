# OpenGate

<p align="center">
  <strong>MCP Security Gateway for AI Agents</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ymstar/opengate-cli"><img src="https://img.shields.io/npm/v/@ymstar/opengate-cli?style=flat-square&logo=npm&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@ymstar/opengate-cli"><img src="https://img.shields.io/npm/dt/@ymstar/opengate-cli?style=flat-square&logo=npm&color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/ymstar/opengate/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ymstar/opengate/ci.yml?style=flat-square&logo=github&label=CI" alt="CI"></a>
  <a href="https://github.com/ymstar/opengate/blob/master/LICENSE"><img src="https://img.shields.io/github/license/ymstar/opengate?style=flat-square&color=blue" alt="License"></a>
  <a href="https://github.com/ymstar/opengate"><img src="https://img.shields.io/github/stars/ymstar/opengate?style=flat-square&logo=github" alt="GitHub stars"></a>
</p>

---

OpenGate sits between AI agent clients (Claude Code, Cursor, Gemini CLI, etc.) and MCP servers. It intercepts every tool call, evaluates declarative security policies, and logs audit trails — giving you control over what your AI agents can do.

```
  MCP Client (Claude Code / Cursor / Any Agent)
          │ stdin/stdout (JSON-RPC)
          ▼
  ┌───────────────────────────┐
  │        OpenGate           │
  │  ┌─────────────────────┐  │
  │  │    Policy Engine    │  │  ← opengate.yaml
  │  │  glob · regex · arg │  │
  │  │  rate-limit · audit │  │
  │  └─────────────────────┘  │
  └───────────────────────────┘
          │ spawn
          ▼
  Real MCP Server (child process)
```

## Why OpenGate?

The MCP protocol has **no per-tool authorization**. Tool annotations (`readOnlyHint`, `destructiveHint`) are self-declared by servers and explicitly untrusted. Existing security tools each cover only one layer:

| Tool | What it does | What it misses |
|------|-------------|----------------|
| AgentShield | Static config scanning | No runtime enforcement |
| Agentic Security | LLM red-teaming | No agent-level policies |
| CUA / Agent Sandbox | Sandboxing | No policy engine |

**OpenGate fills the gap**: runtime per-tool-call policy enforcement, framework-agnostic, via standard MCP protocol.

## Quick Start

### Install

```bash
npm install -g @ymstar/opengate-cli
```

Or run directly with npx:

```bash
npx @ymstar/opengate-cli init
```

### 1. Generate a default policy

```bash
opengate init
```

Creates `opengate.yaml` with example rules.

### 2. Create a server config

```yaml
# opengate-filesystem.yaml
policy: ./opengate.yaml
server:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-filesystem"
    - "/path/to/your/project"
```

### 3. Point your MCP client to OpenGate

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

Every tool call now goes through OpenGate's policy engine.

## Commands

| Command | Description |
|---------|-------------|
| `opengate init` | Generate a default policy file |
| `opengate start` | Start the MCP security proxy (default) |
| `opengate scan` | Scan MCP configurations for security issues |
| `opengate dashboard` | Launch audit log web dashboard |
| `opengate hook` | Run as a Claude Code PreToolUse hook |
| `opengate logs` | View and filter audit logs |

### `opengate scan`

```bash
opengate scan                        # auto-detect config directory
opengate scan --target ~/.claude     # specific directory
opengate scan --format json          # JSON output
```

Detects: hardcoded API keys, overly permissive tool lists, unpinned packages, unencrypted connections, dangerous CLI flags.

### `opengate dashboard`

```bash
opengate dashboard                        # default port 3939
opengate dashboard --port 8080            # custom port
opengate dashboard --audit-log ./log.jsonl
```

### `opengate hook`

Use as a Claude Code PreToolUse hook (no proxy mode needed):

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": ".*",
      "hooks": [{
        "type": "command",
        "command": "opengate hook --policy ./opengate.yaml"
      }]
    }]
  }
}
```

### `opengate logs`

```bash
opengate logs                                    # default: ./audit.jsonl
opengate logs --tool delete                      # filter by tool name
opengate logs --decision blocked                 # filter by decision
opengate logs --server github --limit 20         # last 20 github calls
opengate logs --format json                      # JSON output
```

## Policy Reference

Rules are evaluated top-to-bottom; first match wins.

```yaml
version: "1"
name: "my-policy"
default: deny

settings:
  rateLimit:
    window: 60
    maxCalls: 100
  audit:
    enabled: true
    path: "./audit.jsonl"

rules:
  - id: "allow-read-only"
    match:
      tool:
        annotations:
          readOnlyHint: true
    action: allow

  - id: "block-rm-rf"
    match:
      tool:
        name: "Bash"
        arguments:
          command:
            regex: "rm\\s+-rf|mkfs|dd\\s+if="
    action: block
    reason: "Destructive command"

  - id: "github-rate-limit"
    match:
      server: "github"
      tool:
        name: "*"
    action: allow
    rateLimit:
      window: 60
      maxCalls: 30

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

| Tool Name | Example | Matches |
|-----------|---------|---------|
| Exact | `"Bash"` | Only "Bash" |
| Glob | `"filesystem/*"` | "filesystem/read", "filesystem/write" |
| Regex | `{ regex: ".*delete.*" }` | Any name containing "delete" |

| Argument Operator | Example | Description |
|-------------------|---------|-------------|
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
| `allow` | Forward to the server |
| `block` | Reject with error message |
| `require-approval` | Prompt user in terminal |

### Policy Composition

Inherit from a parent policy:

```yaml
version: "1"
extends: ./strict.yaml
rules:
  - id: "project-override"
    match: { tool: { name: "*" } }
    action: allow
```

Import rules from multiple files:

```yaml
version: "1"
imports:
  - ./base-rules.yaml
  - ./team-rules.yaml
rules: []
```

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
  "durationMs": 42
}
```

```bash
cat audit.jsonl | jq .
opengate dashboard
```

## Architecture

OpenGate intercepts at the **MCP application layer** using the official MCP SDK:

1. Spawns the real MCP server as a child process
2. Discovers all tools via `tools/list`
3. Registers each tool on a proxy server
4. On each `tools/call`, evaluates the policy engine before forwarding
5. Logs every decision to the audit trail

Transparent to both client and server — neither needs to know it's there.

## Development

```bash
git clone https://github.com/ymstar/opengate.git
cd opengate
npm install
npm run build
npm test
```

## License

[MIT](LICENSE)
