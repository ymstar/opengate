# Changelog

## 0.2.0 (2026-05-21)

### Features

- **HTTP transport proxy**: Support for remote MCP servers via `--transport http --port 4000 --upstream http://server:3000/mcp`
- **Static config scanner**: `opengate scan` detects hardcoded secrets, dangerous permissions, supply chain risks
- **Audit dashboard**: `opengate dashboard` launches a web UI for viewing audit logs (port 3939)
- **Claude Code hook**: `opengate hook --policy ./opengate.yaml` runs as a PreToolUse hook without proxy mode
- **Policy composition**: `extends` and `imports` fields for policy inheritance and merging
- **E2E integration test**: Real MCP server test validating tool discovery and policy enforcement

### Improvements

- Graceful shutdown handling (SIGINT/SIGTERM) with child process cleanup
- Error handling for upstream server crashes and disconnections
- Request timeouts (30s for tool calls, 60s for proxied requests)
- Uncaught exception and unhandled rejection handlers
- Better error messages for connection failures

## 0.1.0 (2026-05-21)

### Features

- Stdio MCP proxy with transparent tool forwarding
- Declarative YAML policy engine (glob, regex, argument matching)
- Rate limiting (sliding window per-tool)
- Require-approval flow for high-risk operations
- JSONL audit logging
- CLI with `opengate start` and `opengate init`
- 34 unit tests (matcher + engine)
