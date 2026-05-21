export interface PolicyConfig {
  version: string;
  name?: string;
  description?: string;
  default: "allow" | "deny";
  settings?: PolicySettings;
  rules: PolicyRule[];
}

export interface PolicySettings {
  rateLimit?: {
    window: number;
    maxCalls: number;
  };
  audit?: {
    enabled: boolean;
    path?: string;
    format?: "jsonl" | "json" | "pretty";
    logArguments?: boolean;
    maxArgumentLength?: number;
  };
}

export interface PolicyRule {
  id: string;
  description?: string;
  match: RuleMatch;
  action: "allow" | "block" | "require-approval";
  reason?: string;
  rateLimit?: {
    window: number;
    maxCalls: number;
  };
  approval?: {
    timeout: number;
    message?: string;
  };
}

export interface RuleMatch {
  server?: string;
  tool: ToolMatch;
}

export interface ToolMatch {
  name?: string | StringMatcher;
  arguments?: Record<string, ArgumentMatcher>;
  annotations?: Record<string, unknown>;
}

export interface StringMatcher {
  glob?: string;
  regex?: string;
  equals?: string;
}

export type ArgumentMatcher =
  | string
  | { startsWith: string }
  | { endsWith: string }
  | { contains: string }
  | { regex: string }
  | { equals: string }
  | { in: string[] }
  | { not: ArgumentMatcher };
