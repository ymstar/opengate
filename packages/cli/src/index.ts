#!/usr/bin/env node

import { parseArgs } from "node:util";
import { startCommand } from "./commands/start.js";
import { initCommand } from "./commands/init.js";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    config: { type: "string", short: "c" },
    policy: { type: "string", short: "p" },
    "server-command": { type: "string" },
    "server-args": { type: "string" },
    "audit-log": { type: "string" },
    output: { type: "string", short: "o" },
    verbose: { type: "boolean", short: "v" },
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
  start    Start the MCP security proxy (default)
  init     Generate a default policy file

Options (start):
  -c, --config <path>         Path to config YAML file (contains policy + server definition)
  -p, --policy <path>         Path to policy YAML file (alternative to --config)
  --server-command <cmd>      MCP server command to proxy (alternative to --config)
  --server-args <args>        Comma-separated server arguments
  --audit-log <path>          Path to audit log file
  -v, --verbose               Log audit entries to stderr

Options (init):
  -o, --output <path>         Output path for generated policy file (default: opengate.yaml)

Examples:
  # Generate a default policy
  opengate init

  # Start with a config file
  opengate start --config ./opengate-filesystem.yaml

  # Start with inline server command
  opengate start --server-command npx --server-args "-y,@modelcontextprotocol/server-filesystem,/tmp"

  # Start with policy enforcement
  opengate start --config ./opengate-filesystem.yaml --policy ./opengate.yaml
`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
