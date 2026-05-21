import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ToolCallContext, PolicyDecision, AuditEntry } from "../types.js";
import type { PolicyConfig } from "../policy/schema.js";
import { PolicyEngine } from "../policy/engine.js";
import { AuditLogger, type AuditLoggerOptions } from "../logger/audit-log.js";

export interface HttpProxyOptions {
  port: number;
  upstreamUrl: string;
  policy?: PolicyConfig;
  auditOptions?: AuditLoggerOptions;
  serverName?: string;
}

interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class HttpProxy {
  private options: HttpProxyOptions;
  private policyEngine: PolicyEngine | null;
  private auditLogger: AuditLogger;
  private serverName: string;
  private server: ReturnType<typeof createServer> | null = null;
  private activeRequests = new Set<IncomingMessage>();

  constructor(options: HttpProxyOptions) {
    this.options = options;
    this.serverName = options.serverName ?? "upstream";
    this.policyEngine = options.policy ? new PolicyEngine(options.policy) : null;
    this.auditLogger = new AuditLogger(options.auditOptions);

    this.setupSignalHandlers();
  }

  private setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      process.stderr.write(`\n[OpenGate] Received ${signal}, shutting down HTTP proxy...\n`);
      await this.stop();
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  }

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      this.activeRequests.add(req);
      req.on("close", () => this.activeRequests.delete(req));

      try {
        await this.handleRequest(req, res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[OpenGate] Request error: ${msg}\n`);
        if (!res.headersSent) {
          this.sendError(res, -32603, `Internal error: ${msg}`);
        }
      }
    });

    this.server.on("error", (error) => {
      process.stderr.write(`[OpenGate] Server error: ${error.message}\n`);
    });

    return new Promise((resolve) => {
      this.server!.listen(this.options.port, () => {
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.auditLogger.flush();

    if (this.server) {
      // Wait for active requests to finish (with timeout)
      const timeout = setTimeout(() => {
        process.stderr.write("[OpenGate] Shutdown timeout, forcing close\n");
        process.exit(1);
      }, 10000);

      return new Promise((resolve) => {
        this.server!.close(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", proxy: "opengate" }));
      return;
    }

    if (req.method !== "POST") {
      this.sendError(res, -32600, "Only POST method is supported");
      return;
    }

    const body = await this.readBody(req);
    let request: JsonRpcRequest;

    try {
      request = JSON.parse(body) as JsonRpcRequest;
    } catch {
      this.sendError(res, -32700, "Parse error: invalid JSON");
      return;
    }

    if (request.method === "tools/call" && request.params) {
      const result = await this.interceptToolCall(request);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    await this.forwardToUpstream(body, req.headers, res);
  }

  private async interceptToolCall(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params!;
    const toolName = params.name as string;
    const arguments_ = (params.arguments as Record<string, unknown>) ?? {};

    const ctx: ToolCallContext = {
      toolName,
      arguments: arguments_,
      serverName: this.serverName,
      timestamp: Date.now(),
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
        arguments: arguments_,
        decision: "blocked",
        matchedRule: decision.matchedRule,
        reason: decision.reason,
        durationMs: Date.now() - startTime,
      };
      this.auditLogger.log(entry);

      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32600,
          message: `[OpenGate] BLOCKED: ${decision.reason}`,
        },
      };
    }

    try {
      const upstreamResponse = await this.forwardToolCallToUpstream(request);
      const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        serverName: this.serverName,
        toolName,
        arguments: arguments_,
        decision: decision.action === "require-approval" ? "approved" : "allowed",
        matchedRule: decision.matchedRule,
        reason: decision.reason,
        durationMs: Date.now() - startTime,
      };
      this.auditLogger.log(entry);
      return upstreamResponse;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[OpenGate] Upstream error (${toolName}): ${errorMsg}\n`);

      const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        serverName: this.serverName,
        toolName,
        arguments: arguments_,
        decision: decision.action === "require-approval" ? "approved" : "allowed",
        reason: `Error: ${errorMsg}`,
        durationMs: Date.now() - startTime,
      };
      this.auditLogger.log(entry);

      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: `[OpenGate] Upstream error: ${errorMsg}`,
        },
      };
    }
  }

  private async forwardToolCallToUpstream(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const url = new URL(this.options.upstreamUrl);
    const body = JSON.stringify(request);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body,
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") ?? "";

      if (contentType.includes("text/event-stream")) {
        const text = await response.text();
        const lines = text.split("\n");
        let lastResult: JsonRpcResponse | null = null;

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as JsonRpcResponse;
              if (data.id === request.id) {
                lastResult = data;
              }
            } catch {
              // skip non-JSON SSE lines
            }
          }
        }

        if (lastResult) return lastResult;
      }

      return (await response.json()) as JsonRpcResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async forwardToUpstream(
    body: string,
    headers: IncomingMessage["headers"],
    clientRes: ServerResponse,
  ): Promise<void> {
    const url = new URL(this.options.upstreamUrl);

    const upstreamHeaders: Record<string, string> = {
      "Content-Type": headers["content-type"] ?? "application/json",
      Accept: headers["accept"] ?? "application/json, text/event-stream",
    };

    if (headers.authorization) {
      upstreamHeaders.authorization = headers.authorization;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: upstreamHeaders,
        body,
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") ?? "";

      clientRes.writeHead(response.status, {
        "Content-Type": contentType,
      });

      if (response.body) {
        const reader = response.body.getReader();
        const pump = async (): Promise<void> => {
          const { done, value } = await reader.read();
          if (done) {
            clientRes.end();
            return;
          }
          clientRes.write(value);
          return pump();
        };
        await pump();
      } else {
        clientRes.end();
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  private sendError(res: ServerResponse, code: number, message: string): void {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 0,
      error: { code, message },
    };
    res.writeHead(code === -32700 ? 400 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }
}
