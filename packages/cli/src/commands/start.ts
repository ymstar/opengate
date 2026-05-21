import { StdioProxy } from "@opengate/core";
import { loadProxyConfig } from "../config/loader.js";

export interface StartOptions {
  config?: string;
  policy?: string;
  serverCommand?: string;
  serverArgs?: string[];
  auditLog?: string;
  verbose?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  let serverCommand: string;
  let serverArgs: string[];
  let serverEnv: Record<string, string> | undefined;
  let policy = undefined;
  let auditPath: string | undefined;

  if (options.config) {
    const config = loadProxyConfig(options.config);
    serverCommand = config.server.command;
    serverArgs = config.server.args;
    serverEnv = config.server.env;
    policy = config.policy;
    auditPath = config.audit?.path;
  } else if (options.serverCommand) {
    serverCommand = options.serverCommand;
    serverArgs = options.serverArgs ?? [];
  } else {
    console.error("Error: Either --config or --server-command is required");
    console.error("Usage: opengate start --config ./opengate-filesystem.yaml");
    console.error("       opengate start --server-command npx --server-args '-y,@modelcontextprotocol/server-filesystem,/path'");
    process.exit(1);
  }

  if (options.policy) {
    const { loadPolicyFile } = await import("../config/loader.js");
    policy = loadPolicyFile(options.policy);
  }

  const proxy = new StdioProxy({
    serverCommand,
    serverArgs,
    serverEnv,
    policy,
    auditOptions: {
      path: options.auditLog ?? auditPath,
      format: "jsonl",
      logToStderr: options.verbose ?? false,
    },
  });

  await proxy.start();
}
