import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import yaml from "js-yaml";
import type { PolicyConfig } from "@opengate/core";

export interface ProxyConfig {
  policy?: PolicyConfig;
  policyPath?: string;
  server: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
  audit?: {
    path?: string;
    format?: "jsonl" | "json" | "pretty";
  };
}

export function loadProxyConfig(configPath: string): ProxyConfig {
  const absPath = resolve(configPath);
  if (!existsSync(absPath)) {
    throw new Error(`Config file not found: ${absPath}`);
  }

  const raw = readFileSync(absPath, "utf-8");
  const config = yaml.load(raw) as Record<string, unknown>;

  const dir = dirname(absPath);

  let policy: PolicyConfig | undefined;
  let policyPath: string | undefined;

  if (config.policy) {
    policyPath = resolve(dir, config.policy as string);
    policy = loadPolicyFile(policyPath);
  }

  const server = config.server as Record<string, unknown> | undefined;
  if (!server?.command) {
    throw new Error("Config must specify 'server.command'");
  }

  return {
    policy,
    policyPath,
    server: {
      command: server.command as string,
      args: (server.args as string[]) ?? [],
      env: server.env as Record<string, string> | undefined,
    },
    audit: config.audit as ProxyConfig["audit"],
  };
}

export function loadPolicyFile(policyPath: string): PolicyConfig {
  if (!existsSync(policyPath)) {
    throw new Error(`Policy file not found: ${policyPath}`);
  }

  const raw = readFileSync(policyPath, "utf-8");
  const config = yaml.load(raw) as PolicyConfig;

  validatePolicy(config);
  return config;
}

function validatePolicy(config: unknown): asserts config is PolicyConfig {
  const c = config as Record<string, unknown>;

  if (!c.version) throw new Error("Policy must specify 'version'");
  if (!c.default || (c.default !== "allow" && c.default !== "deny")) {
    throw new Error("Policy must specify 'default' as 'allow' or 'deny'");
  }
  if (!Array.isArray(c.rules)) {
    throw new Error("Policy must specify 'rules' as an array");
  }

  for (const rule of c.rules) {
    const r = rule as Record<string, unknown>;
    if (!r.id) throw new Error("Each rule must have an 'id'");
    if (!r.match) throw new Error(`Rule '${r.id}' must have a 'match'`);
    const match = r.match as Record<string, unknown>;
    if (!match.tool) throw new Error(`Rule '${r.id}' must have 'match.tool'`);
    if (!r.action || !["allow", "block", "require-approval"].includes(r.action as string)) {
      throw new Error(`Rule '${r.id}' must have action: allow, block, or require-approval`);
    }
  }
}
