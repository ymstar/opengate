import { StdioProxy, HttpProxy } from "@opengate/core";
import { loadProxyConfig } from "../config/loader.js";

export interface StartOptions {
  config?: string;
  policy?: string;
  serverCommand?: string;
  serverArgs?: string[];
  upstream?: string;
  port?: number;
  transport?: "stdio" | "http";
  auditLog?: string;
  verbose?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const transport = options.transport ?? "stdio";

  if (transport === "http") {
    await startHttpProxy(options);
  } else {
    await startStdioProxy(options);
  }
}

async function startStdioProxy(options: StartOptions): Promise<void> {
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

async function startHttpProxy(options: StartOptions): Promise<void> {
  if (!options.upstream) {
    console.error("Error: --upstream is required for HTTP transport mode");
    console.error("Usage: opengate start --transport http --port 4000 --upstream http://server:3000/mcp --policy ./opengate.yaml");
    process.exit(1);
  }

  const port = options.port ?? 4000;
  let policy = undefined;

  if (options.config) {
    const config = loadProxyConfig(options.config);
    policy = config.policy;
  }

  if (options.policy) {
    const { loadPolicyFile } = await import("../config/loader.js");
    policy = loadPolicyFile(options.policy);
  }

  const proxy = new HttpProxy({
    port,
    upstreamUrl: options.upstream,
    policy,
    auditOptions: {
      path: options.auditLog,
      format: "jsonl",
      logToStderr: options.verbose ?? false,
    },
  });

  await proxy.start();
  console.log(`OpenGate HTTP proxy listening on http://localhost:${port}`);
  console.log(`Upstream: ${options.upstream}`);
}
