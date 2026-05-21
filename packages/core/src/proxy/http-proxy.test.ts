import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HttpProxy } from "./http-proxy.js";
import type { PolicyConfig } from "../policy/schema.js";

const POLICY: PolicyConfig = {
  version: "1",
  default: "allow",
  rules: [
    {
      id: "block-delete",
      match: { tool: { name: { regex: ".*delete.*" } } },
      action: "block",
      reason: "Deletions blocked",
    },
  ],
};

function makeJsonRpc(id: number, method: string, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0", id, method, params };
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface HealthResponse {
  status: string;
  proxy: string;
}

describe("HttpProxy", () => {
  let port: number;

  beforeAll(async () => {
    port = 19000 + Math.floor(Math.random() * 1000);
  });

  it("health endpoint returns ok", async () => {
    const proxy = new HttpProxy({
      port,
      upstreamUrl: "http://localhost:1",
    });

    await proxy.start();

    const res = await fetch(`http://localhost:${port}/health`);
    const body = (await res.json()) as HealthResponse;

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.proxy).toBe("opengate");

    await proxy.stop();
  });

  it("rejects non-POST methods", async () => {
    const p = port + 1;
    const proxy = new HttpProxy({ port: p, upstreamUrl: "http://localhost:1" });
    await proxy.start();

    const res = await fetch(`http://localhost:${p}/mcp`, { method: "GET" });
    const body = (await res.json()) as JsonRpcResponse;

    expect(body.error).toBeDefined();
    expect(body.error!.message).toContain("POST");

    await proxy.stop();
  });

  it("rejects invalid JSON", async () => {
    const p = port + 2;
    const proxy = new HttpProxy({ port: p, upstreamUrl: "http://localhost:1" });
    await proxy.start();

    const res = await fetch(`http://localhost:${p}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const body = (await res.json()) as JsonRpcResponse;

    expect(body.error).toBeDefined();
    expect(body.error!.code).toBe(-32700);

    await proxy.stop();
  });

  it("blocks tool calls matching policy", async () => {
    const p = port + 3;
    const proxy = new HttpProxy({
      port: p,
      upstreamUrl: "http://localhost:1",
      policy: POLICY,
    });
    await proxy.start();

    const res = await fetch(`http://localhost:${p}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeJsonRpc(1, "tools/call", { name: "delete_file", arguments: { path: "/tmp" } })),
    });
    const body = (await res.json()) as JsonRpcResponse;

    expect(body.error).toBeDefined();
    expect(body.error!.message).toContain("BLOCKED");
    expect(body.error!.message).toContain("Deletions blocked");

    await proxy.stop();
  });

  it("forwards allowed tool calls to upstream", async () => {
    const p = port + 4;
    const { createServer } = await import("node:http");
    const mockServer = createServer((req, res) => {
      let data = "";
      req.on("data", (chunk: Buffer) => (data += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(data) as { id: number };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { content: [{ type: "text", text: "ok" }] } }));
      });
    });
    await new Promise<void>((r) => mockServer.listen(p + 10, () => r()));

    const proxy = new HttpProxy({
      port: p,
      upstreamUrl: `http://localhost:${p + 10}`,
      policy: POLICY,
    });
    await proxy.start();

    const res = await fetch(`http://localhost:${p}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeJsonRpc(2, "tools/call", { name: "read_file", arguments: { path: "/tmp/test" } })),
    });
    const body = (await res.json()) as JsonRpcResponse;

    expect(body.result).toBeDefined();
    const result = body.result as { content: { type: string; text: string }[] };
    expect(result.content[0].text).toBe("ok");

    await proxy.stop();
    await new Promise<void>((r) => mockServer.close(() => r()));
  });
});
