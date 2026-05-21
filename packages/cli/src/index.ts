#!/usr/bin/env node

import { parseArgs } from "node:util";
import { startCommand } from "./commands/start.js";
import { initCommand } from "./commands/init.js";
import { scanCommand } from "./commands/scan.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { hookCommand } from "./commands/hook.js";
import { logsCommand } from "./commands/logs.js";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    config: { type: "string", short: "c" },
    policy: { type: "string", short: "p" },
    "server-command": { type: "string" },
    "server-args": { type: "string" },
    "audit-log": { type: "string" },
    output: { type: "string", short: "o" },
    target: { type: "string", short: "t" },
    port: { type: "string" },
    format: { type: "string", short: "f" },
    verbose: { type: "boolean", short: "v" },
    tool: { type: "string" },
    decision: { type: "string" },
    server: { type: "string" },
    limit: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  strict: false,
});

const command = positionals[0] ?? "start";

if (values.help) {
  printHelp();
  process.exit(0);
}

async function main() {
  switch (command) {
    case "start":
      await startCommand({
        config: values.config as string | undefined,
        policy: values.policy as string | undefined,
        serverCommand: values["server-command"] as string | undefined,
        serverArgs: (values["server-args"] as string | undefined)?.split(","),
        auditLog: values["audit-log"] as string | undefined,
        verbose: values.verbose as boolean | undefined,
      });
      break;

    case "init":
      initCommand({ output: values.output as string | undefined });
      break;

    case "scan":
      scanCommand({
        target: values.target as string | undefined,
        format: values.format as string | undefined,
      });
      break;

    case "dashboard":
      dashboardCommand({
        port: values.port ? parseInt(values.port as string, 10) : undefined,
        auditLog: values["audit-log"] as string | undefined,
      });
      break;

    case "hook":
      if (!values.policy) {
        console.error("Error: --policy is required for hook command");
        process.exit(1);
      }
      hookCommand({ policy: values.policy as string });
      break;

    case "logs":
      logsCommand({
        path: values["audit-log"] as string | undefined,
        format: values.format as string | undefined,
        tool: values.tool as string | undefined,
        decision: values.decision as string | undefined,
        server: values.server as string | undefined,
        limit: values.limit as string | undefined,
      });
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
OpenGate - MCP Security Gateway

Usage:
  opengate [command] [options]

Commands:
  start       Start the MCP security proxy (default)
  init        Generate a default policy file
  scan        Scan MCP configurations for security issues
  dashboard   Launch audit log web dashboard
  hook        Run as a Claude Code PreToolUse hook
  logs        View and filter audit logs

Options (start):
  -c, --config <path>         Config YAML (policy + server definition)
  -p, --policy <path>         Policy YAML file
  --server-command <cmd>      MCP server command to proxy
  --server-args <args>        Comma-separated server arguments
  --audit-log <path>          Audit log output path
  -v, --verbose               Log to stderr

Options (init):
  -o, --output <path>         Output path (default: opengate.yaml)

Options (scan):
  -t, --target <path>         Config directory to scan (auto-detected)
  -f, --format <format>       Output format: text (default), json

Options (dashboard):
  --port <port>               Dashboard port (default: 3939)
  --audit-log <path>          Audit log path (default: ./audit.jsonl)

Options (hook):
  -p, --policy <path>         Policy YAML file (required)

Options (logs):
  --audit-log <path>          Audit log path (default: ./audit.jsonl)
  -f, --format <format>       Output format: table (default), json, jsonl
  --tool <name>               Filter by tool name (substring match)
  --decision <value>          Filter by decision: allowed, blocked, approved
  --server <name>             Filter by server name
  --limit <n>                 Show last N entries

Examples:
  opengate init
  opengate scan
  opengate start --config ./opengate-filesystem.yaml
  opengate dashboard --port 3939 --audit-log ./audit.jsonl
  opengate hook --policy ./opengate.yaml
  opengate logs
  opengate logs --tool delete --decision blocked --limit 20
  opengate logs --format json
`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
