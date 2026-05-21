import { readFileSync, existsSync } from "node:fs";

interface AuditEntry {
  timestamp: string;
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
  decision: string;
  matchedRule?: string;
  reason?: string;
  durationMs: number;
}

interface LogsOptions {
  path?: string;
  format?: string;
  tool?: string;
  decision?: string;
  server?: string;
  limit?: string;
}

export function logsCommand(options: LogsOptions): void {
  const logPath = options.path ?? "./audit.jsonl";

  if (!existsSync(logPath)) {
    console.error(`Audit log not found: ${logPath}`);
    console.error("Run a proxy with --audit-log to generate logs, or specify --path.");
    process.exit(1);
  }

  const raw = readFileSync(logPath, "utf-8").trim();
  if (!raw) {
    console.log("Audit log is empty.");
    return;
  }

  let entries: AuditEntry[] = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditEntry);

  // Apply filters
  if (options.tool) {
    const pattern = options.tool;
    entries = entries.filter((e) => e.toolName.includes(pattern));
  }
  if (options.decision) {
    entries = entries.filter((e) => e.decision === options.decision);
  }
  if (options.server) {
    entries = entries.filter((e) => e.serverName === options.server);
  }
  if (options.limit) {
    const n = parseInt(options.limit, 10);
    entries = entries.slice(-n);
  }

  if (entries.length === 0) {
    console.log("No matching log entries.");
    return;
  }

  const format = options.format ?? "table";

  if (format === "json") {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (format === "jsonl") {
    for (const entry of entries) {
      console.log(JSON.stringify(entry));
    }
    return;
  }

  // Table format
  printTable(entries);
}

function printTable(entries: AuditEntry[]): void {
  const header = `${"TIMESTAMP".padEnd(26)} ${"DECISION".padEnd(10)} ${"SERVER".padEnd(12)} ${"TOOL".padEnd(20)} ${"RULE".padEnd(20)} ${"MS".padEnd(6)} REASON`;
  console.log(header);
  console.log("-".repeat(header.length));

  for (const e of entries) {
    const ts = e.timestamp.replace("T", " ").replace("Z", "");
    const dec = e.decision.toUpperCase().padEnd(10);
    const srv = (e.serverName ?? "-").slice(0, 12).padEnd(12);
    const tool = e.toolName.slice(0, 20).padEnd(20);
    const rule = (e.matchedRule ?? "-").slice(0, 20).padEnd(20);
    const ms = String(e.durationMs).padEnd(6);
    const reason = (e.reason ?? "-").slice(0, 50);
    console.log(`${ts} ${dec} ${srv} ${tool} ${rule} ${ms} ${reason}`);
  }

  console.log(`\n${entries.length} entries`);
}
