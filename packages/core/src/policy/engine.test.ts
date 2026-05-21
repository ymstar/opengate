import { describe, it, expect } from "vitest";
import { PolicyEngine } from "./engine.js";
import type { PolicyConfig } from "./schema.js";
import type { ToolCallContext } from "../types.js";

function makeCtx(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "test-tool",
    arguments: {},
    serverName: "test-server",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("PolicyEngine", () => {
  it("returns default allow when no rules match", () => {
    const engine = new PolicyEngine({
      version: "1",
      default: "allow",
      rules: [],
    });
    expect(engine.evaluate(makeCtx())).toEqual({
      action: "allow",
      reason: "No rule matched, default allow",
    });
  });

  it("returns default deny when no rules match", () => {
    const engine = new PolicyEngine({
      version: "1",
      default: "deny",
      rules: [],
    });
    expect(engine.evaluate(makeCtx())).toEqual({
      action: "block",
      reason: "No rule matched, default deny",
    });
  });

  it("matches tool name exactly", () => {
    const config: PolicyConfig = {
      version: "1",
      default: "allow",
      rules: [
        {
          id: "block-delete",
          match: { tool: { name: "filesystem/delete" } },
          action: "block",
          reason: "No deletes allowed",
        },
      ],
    };
    const engine = new PolicyEngine(config);

    expect(engine.evaluate(makeCtx({ toolName: "filesystem/delete" })).action).toBe("block");
    expect(engine.evaluate(makeCtx({ toolName: "filesystem/read" })).action).toBe("allow");
  });

  it("matches tool name with glob", () => {
    const config: PolicyConfig = {
      version: "1",
      default: "allow",
      rules: [
        {
          id: "block-all-delete",
          match: { tool: { name: { glob: "*delete*" } } },
          action: "block",
        },
      ],
    };
    const engine = new PolicyEngine(config);

    expect(engine.evaluate(makeCtx({ toolName: "filesystem/delete_file" })).action).toBe("block");
    expect(engine.evaluate(makeCtx({ toolName: "github/remove_repo" })).action).toBe("allow");
  });

  it("matches tool name with regex", () => {
    const config: PolicyConfig = {
      version: "1",
      default: "allow",
      rules: [
        {
          id: "block-dangerous",
          match: { tool: { name: { regex: ".*delete.*|.*remove.*" } } },
          action: "block",
        },
      ],
    };
    const engine = new PolicyEngine(config);

    expect(engine.evaluate(makeCtx({ toolName: "delete_item" })).action).toBe("block");
    expect(engine.evaluate(makeCtx({ toolName: "remove_user" })).action).toBe("block");
    expect(engine.evaluate(makeCtx({ toolName: "create_item" })).action).toBe("allow");
  });

  it("matches arguments", () => {
    const config: PolicyConfig = {
      version: "1",
      default: "allow",
      rules: [
        {
          id: "block-rm-rf",
          match: {
            tool: {
              name: "Bash",
              arguments: { command: { regex: "rm\\s+-rf" } },
            },
          },
          action: "block",
          reason: "Destructive command",
        },
      ],
    };
    const engine = new PolicyEngine(config);

    expect(engine.evaluate(makeCtx({ toolName: "Bash", arguments: { command: "rm -rf /" } })).action).toBe("block");
    expect(engine.evaluate(makeCtx({ toolName: "Bash", arguments: { command: "ls -la" } })).action).toBe("allow");
    expect(engine.evaluate(makeCtx({ toolName: "Read", arguments: { path: "/tmp" } })).action).toBe("allow");
  });

  it("matches server name", () => {
    const config: PolicyConfig = {
      version: "1",
      default: "allow",
      rules: [
        {
          id: "github-limit",
          match: { server: "github", tool: { name: "*" } },
          action: "allow",
          rateLimit: { window: 60, maxCalls: 2 },
        },
      ],
    };
    const engine = new PolicyEngine(config);

    const githubCtx = makeCtx({ serverName: "github", toolName: "create_issue" });
    expect(engine.evaluate(githubCtx).action).toBe("allow");
    expect(engine.evaluate(githubCtx).action).toBe("allow");
    expect(engine.evaluate(githubCtx).action).toBe("block"); // rate limited

    const otherCtx = makeCtx({ serverName: "filesystem", toolName: "read" });
    expect(engine.evaluate(otherCtx).action).toBe("allow");
    expect(engine.evaluate(otherCtx).action).toBe("allow");
    expect(engine.evaluate(otherCtx).action).toBe("allow"); // not rate limited
  });

  it("evaluates rules in order (first match wins)", () => {
    const config: PolicyConfig = {
      version: "1",
      default: "allow",
      rules: [
        {
          id: "allow-all",
          match: { tool: { name: "*" } },
          action: "allow",
        },
        {
          id: "block-delete",
          match: { tool: { name: "*delete*" } },
          action: "block",
        },
      ],
    };
    const engine = new PolicyEngine(config);

    // "allow-all" matches first, so delete is allowed
    expect(engine.evaluate(makeCtx({ toolName: "delete_item" })).action).toBe("allow");
  });

  it("supports require-approval action", () => {
    const config: PolicyConfig = {
      version: "1",
      default: "allow",
      rules: [
        {
          id: "approve-delete",
          match: { tool: { name: "*delete*" } },
          action: "require-approval",
          approval: { timeout: 30 },
        },
      ],
    };
    const engine = new PolicyEngine(config);

    expect(engine.evaluate(makeCtx({ toolName: "delete_item" })).action).toBe("require-approval");
  });

  it("matches annotations", () => {
    const config: PolicyConfig = {
      version: "1",
      default: "deny",
      rules: [
        {
          id: "allow-readonly",
          match: {
            tool: { annotations: { readOnlyHint: true } },
          },
          action: "allow",
        },
      ],
    };
    const engine = new PolicyEngine(config);

    expect(
      engine.evaluate(makeCtx({ toolName: "read", annotations: { readOnlyHint: true } })).action,
    ).toBe("allow");
    expect(
      engine.evaluate(makeCtx({ toolName: "write", annotations: { readOnlyHint: false } })).action,
    ).toBe("block");
    expect(engine.evaluate(makeCtx({ toolName: "write" })).action).toBe("block");
  });
});
