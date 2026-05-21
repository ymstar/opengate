import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { loadProxyConfig, loadPolicyFile } from "./loader.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Config Loader", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = join(tmpdir(), "opengate-test-" + Date.now());
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("loadPolicyFile", () => {
    it("loads a valid policy file", () => {
      const path = join(testDir, "policy.yaml");
      writeFileSync(
        path,
        `
version: "1"
default: allow
rules:
  - id: "test-rule"
    match:
      tool:
        name: "Bash"
    action: block
    reason: "blocked"
`
      );
      const policy = loadPolicyFile(path);
      expect(policy.version).toBe("1");
      expect(policy.default).toBe("allow");
      expect(policy.rules).toHaveLength(1);
      expect(policy.rules[0].id).toBe("test-rule");
    });

    it("throws on missing version", () => {
      const path = join(testDir, "bad-version.yaml");
      writeFileSync(path, `default: allow\nrules: []`);
      expect(() => loadPolicyFile(path)).toThrow("version");
    });

    it("throws on invalid default", () => {
      const path = join(testDir, "bad-default.yaml");
      writeFileSync(path, `version: "1"\ndefault: maybe\nrules: []`);
      expect(() => loadPolicyFile(path)).toThrow("default");
    });

    it("throws on missing rules array", () => {
      const path = join(testDir, "bad-rules.yaml");
      writeFileSync(path, `version: "1"\ndefault: allow`);
      expect(() => loadPolicyFile(path)).toThrow("rules");
    });

    it("throws on rule without id", () => {
      const path = join(testDir, "bad-rule-id.yaml");
      writeFileSync(
        path,
        `version: "1"\ndefault: allow\nrules:\n  - match:\n      tool:\n        name: "x"\n    action: allow`
      );
      expect(() => loadPolicyFile(path)).toThrow("id");
    });

    it("throws on rule without action", () => {
      const path = join(testDir, "bad-rule-action.yaml");
      writeFileSync(
        path,
        `version: "1"\ndefault: allow\nrules:\n  - id: "r1"\n    match:\n      tool:\n        name: "x"`
      );
      expect(() => loadPolicyFile(path)).toThrow("action");
    });

    it("throws on file not found", () => {
      expect(() => loadPolicyFile(join(testDir, "nonexistent.yaml"))).toThrow("not found");
    });

    it("supports extends composition", () => {
      const parentPath = join(testDir, "parent.yaml");
      writeFileSync(
        parentPath,
        `
version: "1"
default: deny
rules:
  - id: "parent-rule"
    match:
      tool:
        name: "*"
    action: allow
`
      );
      const childPath = join(testDir, "child.yaml");
      writeFileSync(
        childPath,
        `
version: "1"
extends: ./parent.yaml
rules:
  - id: "child-rule"
    match:
      tool:
        name: "Bash"
    action: block
`
      );
      const policy = loadPolicyFile(childPath);
      // Child rules come first
      expect(policy.rules[0].id).toBe("child-rule");
      expect(policy.rules[1].id).toBe("parent-rule");
      // Default inherited from parent since child didn't set it
      expect(policy.default).toBe("deny");
    });

    it("supports imports composition", () => {
      const base1 = join(testDir, "base1.yaml");
      writeFileSync(
        base1,
        `
version: "1"
default: allow
rules:
  - id: "base1-rule"
    match:
      tool:
        name: "A"
    action: allow
`
      );
      const base2 = join(testDir, "base2.yaml");
      writeFileSync(
        base2,
        `
version: "1"
default: allow
rules:
  - id: "base2-rule"
    match:
      tool:
        name: "B"
    action: block
`
      );
      const mainPath = join(testDir, "main.yaml");
      writeFileSync(
        mainPath,
        `
version: "1"
default: deny
imports:
  - ./base1.yaml
  - ./base2.yaml
rules:
  - id: "main-rule"
    match:
      tool:
        name: "C"
    action: allow
`
      );
      const policy = loadPolicyFile(mainPath);
      expect(policy.rules.map((r) => r.id)).toEqual(["main-rule", "base1-rule", "base2-rule"]);
    });
  });

  describe("loadProxyConfig", () => {
    it("loads a valid proxy config", () => {
      const policyPath = join(testDir, "proxy-policy.yaml");
      writeFileSync(
        policyPath,
        `
version: "1"
default: allow
rules:
  - id: "r1"
    match:
      tool:
        name: "*"
    action: allow
`
      );
      const configPath = join(testDir, "proxy-config.yaml");
      writeFileSync(
        configPath,
        `
policy: ./proxy-policy.yaml
server:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-filesystem"
    - "/tmp"
`
      );
      const config = loadProxyConfig(configPath);
      expect(config.server.command).toBe("npx");
      expect(config.server.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]);
      expect(config.policy).toBeDefined();
      expect(config.policy!.version).toBe("1");
    });

    it("throws on missing config file", () => {
      expect(() => loadProxyConfig(join(testDir, "nope.yaml"))).toThrow("not found");
    });

    it("throws on missing server.command", () => {
      const path = join(testDir, "no-cmd.yaml");
      writeFileSync(path, `server:\n  args: []`);
      expect(() => loadProxyConfig(path)).toThrow("server.command");
    });

    it("works without policy field", () => {
      const path = join(testDir, "no-policy.yaml");
      writeFileSync(path, `server:\n  command: echo\n  args: ["hello"]`);
      const config = loadProxyConfig(path);
      expect(config.policy).toBeUndefined();
      expect(config.server.command).toBe("echo");
    });
  });
});
