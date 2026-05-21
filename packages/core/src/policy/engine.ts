import type { ToolCallContext, PolicyDecision } from "../types.js";
import type { PolicyConfig, PolicyRule } from "./schema.js";
import { matchString, matchArguments, matchAnnotations } from "./matcher.js";

export class PolicyEngine {
  private config: PolicyConfig;
  private rateLimitCounters: Map<string, number[]> = new Map();

  constructor(config: PolicyConfig) {
    this.config = config;
  }

  evaluate(ctx: ToolCallContext): PolicyDecision {
    for (const rule of this.config.rules) {
      if (this.matchRule(rule, ctx)) {
        if (rule.rateLimit) {
          const key = `${rule.id}:${ctx.toolName}`;
          if (!this.checkRateLimit(key, rule.rateLimit.window, rule.rateLimit.maxCalls)) {
            return {
              action: "block",
              reason: `Rate limit exceeded for rule '${rule.id}' (${rule.rateLimit.maxCalls} calls per ${rule.rateLimit.window}s)`,
              matchedRule: rule.id,
            };
          }
        }

        return {
          action: rule.action,
          reason: rule.reason ?? `Matched rule '${rule.id}'`,
          matchedRule: rule.id,
        };
      }
    }

    return {
      action: this.config.default === "allow" ? "allow" : "block",
      reason: this.config.default === "allow" ? "No rule matched, default allow" : "No rule matched, default deny",
    };
  }

  private matchRule(rule: PolicyRule, ctx: ToolCallContext): boolean {
    if (rule.match.server !== undefined && rule.match.server !== ctx.serverName) {
      return false;
    }

    const toolMatch = rule.match.tool;

    if (typeof toolMatch.name === "string") {
      if (!matchString(toolMatch.name, ctx.toolName)) return false;
    } else if (typeof toolMatch.name === "object") {
      if (!matchString(toolMatch.name, ctx.toolName)) return false;
    }

    if (toolMatch.arguments) {
      if (!matchArguments(toolMatch.arguments, ctx.arguments)) return false;
    }

    if (toolMatch.annotations) {
      if (!matchAnnotations(toolMatch.annotations, ctx.annotations)) return false;
    }

    return true;
  }

  private checkRateLimit(key: string, windowSeconds: number, maxCalls: number): boolean {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const cutoff = now - windowMs;

    let timestamps = this.rateLimitCounters.get(key);
    if (!timestamps) {
      timestamps = [];
      this.rateLimitCounters.set(key, timestamps);
    }

    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= maxCalls) {
      return false;
    }

    timestamps.push(now);
    return true;
  }
}
