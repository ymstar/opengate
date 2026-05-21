export interface ToolCallContext {
  toolName: string;
  arguments: Record<string, unknown>;
  serverName: string;
  timestamp: number;
  annotations?: Record<string, unknown>;
}

export type PolicyAction = "allow" | "block" | "require-approval";

export interface PolicyDecision {
  action: PolicyAction;
  reason: string;
  matchedRule?: string;
}

export interface AuditEntry {
  timestamp: string;
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
  decision: "allowed" | "blocked" | "approval-required" | "approved" | "denied";
  matchedRule?: string;
  reason: string;
  durationMs: number;
  resultSummary?: string;
}
