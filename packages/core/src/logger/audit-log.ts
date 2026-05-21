import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditEntry } from "../types.js";

export type AuditLogFormat = "jsonl" | "json" | "pretty";

export interface AuditLoggerOptions {
  path?: string;
  format?: AuditLogFormat;
  logArguments?: boolean;
  maxArgumentLength?: number;
  logToStderr?: boolean;
}

export class AuditLogger {
  private path: string | undefined;
  private format: AuditLogFormat;
  private logArguments: boolean;
  private maxArgumentLength: number;
  private logToStderr: boolean;
  private buffer: AuditEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AuditLoggerOptions = {}) {
    this.path = options.path;
    this.format = options.format ?? "jsonl";
    this.logArguments = options.logArguments ?? true;
    this.maxArgumentLength = options.maxArgumentLength ?? 1024;
    this.logToStderr = options.logToStderr ?? false;
  }

  log(entry: AuditEntry): void {
    const processed = this.processEntry(entry);
    this.buffer.push(processed);

    if (this.logToStderr) {
      process.stderr.write(this.formatEntry(processed) + "\n");
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 100);
    }
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length === 0 || !this.path) return;

    const dir = dirname(this.path);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // directory may already exist
    }

    if (this.format === "jsonl") {
      const lines = this.buffer.map((e) => JSON.stringify(e)).join("\n") + "\n";
      appendFileSync(this.path, lines);
    } else if (this.format === "json") {
      writeFileSync(this.path, JSON.stringify(this.buffer, null, 2));
    } else {
      const lines = this.buffer.map((e) => this.formatEntry(e)).join("\n") + "\n";
      appendFileSync(this.path, lines);
    }

    this.buffer = [];
  }

  private processEntry(entry: AuditEntry): AuditEntry {
    if (!this.logArguments) {
      return { ...entry, arguments: {} };
    }

    const argsStr = JSON.stringify(entry.arguments);
    if (argsStr.length > this.maxArgumentLength) {
      return {
        ...entry,
        arguments: { _truncated: argsStr.slice(0, this.maxArgumentLength) + "..." },
      };
    }

    return entry;
  }

  private formatEntry(entry: AuditEntry): string {
    const status = entry.decision.toUpperCase();
    const rule = entry.matchedRule ? ` [${entry.matchedRule}]` : "";
    return `[${entry.timestamp}] ${status} ${entry.serverName}/${entry.toolName}${rule} - ${entry.reason} (${entry.durationMs}ms)`;
  }
}
