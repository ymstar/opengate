import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ToolCallContext, PolicyDecision, AuditEntry } from "../types.js";
import type { PolicyConfig } from "../policy/schema.js";
import { PolicyEngine } from "../policy/engine.js";
import { AuditLogger, type AuditLoggerOptions } from "../logger/audit-log.js";

export interface StdioProxyOptions {
  serverCommand: string;
  serverArgs: string[];
  serverEnv?: Record<string, string>;
  policy?: PolicyConfig;
  auditOptions?: AuditLoggerOptions;
  serverName?: string;
}

export class StdioProxy {
  private options: StdioProxyOptions;
  private policyEngine: PolicyEngine | null;
  private auditLogger: AuditLogger;
  private serverName: string;
  private client: Client | null = null;
  private clientTransport: StdioClientTransport | null = null;
  private shuttingDown = false;

  constructor(options: StdioProxyOptions) {
    this.options = options;
    this.serverName = options.serverName ?? "upstream";
    this.policyEngine = options.policy ? new PolicyEngine(options.policy) : null;
    this.auditLogger = new AuditLogger(options.auditOptions);

    this.setupSignalHandlers();
  }

  private setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      if (this.shuttingDown) return;
      this.shuttingDown = true;
      process.stderr.write(`\n[OpenGate] Received ${signal}, shutting down...\n`);
      await this.shutdown();
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    process.on("uncaughtException", (error) => {
      process.stderr.write(`[OpenGate] Uncaught exception: ${error.message}\n`);
      this.shutdown().finally(() => process.exit(1));
    });

    process.on("unhandledRejection", (reason) => {
      process.stderr.write(`[OpenGate] Unhandled rejection: ${reason}\n`);
    });
  }

  private async shutdown(): Promise<void> {
    this.auditLogger.flush();

    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // ignore close errors during shutdown
      }
    }

    if (this.clientTransport) {
      try {
        await this.clientTransport.close();
      } catch {
        // ignore close errors during shutdown
      }
    }
  }

  async start(): Promise<void> {
    this.clientTransport = new StdioClientTransport({
      command: this.options.serverCommand,
      args: this.options.serverArgs,
      env: this.options.serverEnv as Record<string, string>,
    });

    this.client = new Client({ name: "opengate-proxy", version: "0.1.0" });

    this.clientTransport.onerror = (error) => {
      process.stderr.write(`[OpenGate] Upstream server error: ${error.message}\n`);
    };

    this.clientTransport.onclose = () => {
      if (!this.shuttingDown) {
        process.stderr.write("[OpenGate] Upstream server disconnected\n");
        this.auditLogger.flush();
        process.exit(1);
      }
    };

    try {
      await this.client.connect(this.clientTransport);
    } catch (error) {
      process.stderr.write(
        `[OpenGate] Failed to connect to upstream server: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.stderr.write(`[OpenGate] Command: ${this.options.serverCommand} ${this.options.serverArgs.join(" ")}\n`);
      process.exit(1);
    }

    let tools: Array<{
      name: string;
      description?: string;
      inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
      annotations?: Record<string, unknown>;
    }>;

    try {
      const result = await this.client.listTools();
      tools = result.tools;
    } catch (error) {
      process.stderr.write(
        `[OpenGate] Failed to list tools: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    }

    const mcpServer = new McpServer({
      name: "opengate-proxy",
      version: "0.1.0",
    });

    for (const tool of tools) {
      const toolName = tool.name;
      const annotations = tool.annotations as Record<string, unknown> | undefined;

      mcpServer.tool(
        toolName,
        tool.description ?? "",
        tool.inputSchema?.properties
          ? Object.fromEntries(
              Object.entries(tool.inputSchema.properties).map(([k, v]) => [
                k,
                (v as Record<string, unknown>).description ?? "",
              ]),
            )
          : {},
        async (args: Record<string, unknown>) => {
          if (this.shuttingDown) {
            return {
              content: [{ type: "text" as const, text: "[OpenGate] Server is shutting down" }],
              isError: true,
            };
          }

          const ctx: ToolCallContext = {
            toolName,
            arguments: args,
            serverName: this.serverName,
            timestamp: Date.now(),
            annotations,
          };

          const startTime = Date.now();
          let decision: PolicyDecision;

          if (this.policyEngine) {
            decision = this.policyEngine.evaluate(ctx);
          } else {
            decision = { action: "allow", reason: "No policy configured" };
          }

          if (decision.action === "block") {
            const entry: AuditEntry = {
              timestamp: new Date().toISOString(),
              serverName: this.serverName,
              toolName,
              arguments: args,
              decision: "blocked",
              matchedRule: decision.matchedRule,
              reason: decision.reason,
              durationMs: Date.now() - startTime,
            };
            this.auditLogger.log(entry);

            return {
              content: [{ type: "text" as const, text: `[OpenGate] BLOCKED: ${decision.reason}` }],
              isError: true,
            };
          }

          if (decision.action === "require-approval") {
            const approved = await this.requestApproval(toolName, args, decision);
            if (!approved) {
              const entry: AuditEntry = {
                timestamp: new Date().toISOString(),
                serverName: this.serverName,
                toolName,
                arguments: args,
                decision: "denied",
                matchedRule: decision.matchedRule,
                reason: "User denied approval",
                durationMs: Date.now() - startTime,
              };
              this.auditLogger.log(entry);

              return {
                content: [{ type: "text" as const, text: `[OpenGate] DENIED: User denied approval for '${toolName}'` }],
                isError: true,
              };
            }
          }

          try {
            const result = await this.client!.callTool({ name: toolName, arguments: args });
            const durationMs = Date.now() - startTime;

            const resultText = Array.isArray(result.content)
              ? result.content
                  .filter((c: { type: string }) => c.type === "text")
                  .map((c: { text: string }) => c.text)
                  .join(" ")
                  .slice(0, 200)
              : undefined;

            const entry: AuditEntry = {
              timestamp: new Date().toISOString(),
              serverName: this.serverName,
              toolName,
              arguments: args,
              decision: decision.action === "require-approval" ? "approved" : "allowed",
              matchedRule: decision.matchedRule,
              reason: decision.reason,
              durationMs,
              resultSummary: resultText,
            };
            this.auditLogger.log(entry);

            return {
              content: result.content as Array<{ type: "text"; text: string }>,
              isError: result.isError as boolean | undefined,
            };
          } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorMsg = error instanceof Error ? error.message : String(error);

            process.stderr.write(`[OpenGate] Tool call error (${toolName}): ${errorMsg}\n`);

            const entry: AuditEntry = {
              timestamp: new Date().toISOString(),
              serverName: this.serverName,
              toolName,
              arguments: args,
              decision: decision.action === "require-approval" ? "approved" : "allowed",
              reason: `Error: ${errorMsg}`,
              durationMs,
            };
            this.auditLogger.log(entry);

            return {
              content: [{ type: "text" as const, text: `[OpenGate] Tool call failed: ${errorMsg}` }],
              isError: true,
            };
          }
        },
      );
    }

    const serverTransport = new StdioServerTransport();
    await mcpServer.connect(serverTransport);

    this.auditLogger.flush();
  }

  private async requestApproval(
    toolName: string,
    args: Record<string, unknown>,
    decision: PolicyDecision,
  ): Promise<boolean> {
    const timeout = 30000;

    process.stderr.write(
      `\n[OpenGate] APPROVAL REQUIRED\n` +
        `  Tool: ${toolName}\n` +
        `  Arguments: ${JSON.stringify(args, null, 2)}\n` +
        `  Rule: ${decision.matchedRule ?? "N/A"}\n` +
        `  Reason: ${decision.reason}\n` +
        `  Approve? [y/N]: `,
    );

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        process.stderr.write("\n[OpenGate] Approval timed out, denying.\n");
        cleanup();
        resolve(false);
      }, timeout);

      const onData = (chunk: Buffer) => {
        const input = chunk.toString().trim().toLowerCase();
        cleanup();
        resolve(input === "y" || input === "yes");
      };

      const cleanup = () => {
        clearTimeout(timer);
        process.stdin.removeListener("data", onData);
      };

      process.stdin.on("data", onData);
    });
  }
}
