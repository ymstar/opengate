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

  constructor(options: HttpProxyOptions) {
    this.options = options;
    this.serverName = options.serverName ?? "upstream";
    this.policyEngine = options.policy ? new PolicyEngine(options.policy) : null;
    this.auditLogger = new AuditLogger(options.auditOptions);
  }

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      try {
        await this.handleRequest(req, res);
      } catch (error) {
        this.sendError(res, -32603, `Internal error: ${error instanceof Error ? error.message : String(error)}`);
      }
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
      return new Promise((resolve) => {
        this.server!.close(() => resolve());
      });
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", proxy: "opengate" }));
      return;
    }

    // Only handle POST for MCP JSON-RPC
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

    // Intercept tools/call
    if (request.method === "tools/call" && request.params) {
      const result = await this.interceptToolCall(request);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    // Forward everything else to upstream
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

    // For allow and require-approval (HTTP mode auto-allows approval),
    // forward to upstream
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
      const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        serverName: this.serverName,
        toolName,
        arguments: arguments_,
        decision: decision.action === "require-approval" ? "approved" : "allowed",
        reason: `Error: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
      };
      this.auditLogger.log(entry);
      throw error;
    }
  }

  private async forwardToolCallToUpstream(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const url = new URL(this.options.upstreamUrl);
    const body = JSON.stringify(request);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body,
    });

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("text/event-stream")) {
      // SSE response - read all events and return the last JSON-RPC response
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

    // Regular JSON response
    const data = (await response.json()) as JsonRpcResponse;
    return data;
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

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: upstreamHeaders,
      body,
    });

    const contentType = response.headers.get("content-type") ?? "";

    // Set response headers
    clientRes.writeHead(response.status, {
      "Content-Type": contentType,
    });

    // Stream the response body
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
