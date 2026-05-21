import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";

interface ScanFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  message: string;
  file?: string;
  line?: number;
}

interface ScanResult {
  findings: ScanFinding[];
  score: number;
  grade: string;
}

export function scanCommand(options: { target?: string; format?: string }): void {
  const findings: ScanFinding[] = [];
  const target = options.target ?? detectConfigDir();

  if (!target) {
    console.error("Could not detect MCP configuration directory.");
    console.error("Usage: opengate scan [--target <path>]");
    process.exit(1);
  }

  console.log(`Scanning: ${target}\n`);

  // Scan Claude Code configs
  scanClaudeCodeConfigs(target, findings);

  // Scan Cursor configs
  scanCursorConfigs(target, findings);

  // Scan MCP server packages for known vulnerabilities
  scanMcpServerPackages(target, findings);

  // Scan policy files
  scanPolicyFiles(target, findings);

  const result = calculateScore(findings);

  if (options.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }

  if (result.grade === "F" || result.findings.some((f) => f.severity === "critical")) {
    process.exit(1);
  }
}

function detectConfigDir(): string | null {
  const home = homedir();
  const candidates = [
    join(home, ".claude"),
    join(home, ".cursor"),
    resolve(".claude"),
    resolve(".cursor"),
  ];

  for (const dir of candidates) {
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      return dir;
    }
  }
  return null;
}

function scanClaudeCodeConfigs(baseDir: string, findings: ScanFinding[]): void {
  // Scan settings.json
  const settingsPath = join(baseDir, "settings.json");
  if (existsSync(settingsPath)) {
    scanJsonFile(settingsPath, findings, "claude-code");
  }

  // Scan settings.local.json
  const localSettingsPath = join(baseDir, "settings.local.json");
  if (existsSync(localSettingsPath)) {
    scanJsonFile(localSettingsPath, findings, "claude-code");
  }

  // Scan CLAUDE.md for secrets
  const claudeMdPath = join(baseDir, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    scanTextFile(claudeMdPath, findings, "claude-code");
  }

  // Scan .mcp.json
  const mcpJsonPath = join(baseDir, ".mcp.json");
  if (existsSync(mcpJsonPath)) {
    scanJsonFile(mcpJsonPath, findings, "mcp-config");
  }

  // Scan skills directory
  const skillsDir = join(baseDir, "skills");
  if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
    scanDirectory(skillsDir, findings, "skills");
  }
}

function scanCursorConfigs(baseDir: string, findings: ScanFinding[]): void {
  const cursorDir = baseDir.includes(".cursor") ? baseDir : join(baseDir, "..", ".cursor");
  if (!existsSync(cursorDir)) return;

  const mcpPath = join(cursorDir, "mcp.json");
  if (existsSync(mcpPath)) {
    scanJsonFile(mcpPath, findings, "cursor-mcp");
  }
}

function scanJsonFile(filePath: string, findings: ScanFinding[], source: string): void {
  try {
    const raw = readFileSync(filePath, "utf-8");

    // Check for hardcoded tokens/secrets
    const secretPatterns = [
      { pattern: /ghp_[a-zA-Z0-9]{36}/, name: "GitHub Personal Access Token" },
      { pattern: /sk-[a-zA-Z0-9]{48}/, name: "OpenAI API Key" },
      { pattern: /sk-ant-[a-zA-Z0-9-]{93}/, name: "Anthropic API Key" },
      { pattern: /AKIA[0-9A-Z]{16}/, name: "AWS Access Key ID" },
      { pattern: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/, name: "JWT Token" },
      { pattern: /xoxb-[0-9]+-[a-zA-Z0-9]+/, name: "Slack Bot Token" },
      { pattern: /Bearer\s+[a-zA-Z0-9_-]{20,}/, name: "Bearer Token" },
    ];

    for (const { pattern, name } of secretPatterns) {
      if (pattern.test(raw)) {
        findings.push({
          severity: "critical",
          category: "secrets",
          message: `Hardcoded ${name} detected in ${source} config`,
          file: filePath,
        });
      }
    }

    const config = JSON.parse(raw);

    // Check MCP server configs
    const mcpServers = config.mcpServers ?? config.mcpServers ?? {};
    for (const [name, serverConfig] of Object.entries(mcpServers)) {
      const sc = serverConfig as Record<string, unknown>;

      // Check for overly broad permissions
      if (sc.command === "npx" && Array.isArray(sc.args)) {
        const args = sc.args as string[];
        if (args.some((a) => a.includes("--dangerously-skip-permissions"))) {
          findings.push({
            severity: "high",
            category: "permissions",
            message: `MCP server '${name}' uses --dangerously-skip-permissions`,
            file: filePath,
          });
        }
      }

      // Check for env vars with secrets
      if (sc.env && typeof sc.env === "object") {
        for (const [envKey, envValue] of Object.entries(sc.env as Record<string, string>)) {
          if (typeof envValue === "string" && envValue.length > 20 && !envValue.startsWith("$")) {
            findings.push({
              severity: "high",
              category: "secrets",
              message: `MCP server '${name}' has hardcoded value for env var '${envKey}'`,
              file: filePath,
            });
          }
        }
      }

      // Check for url-based servers (remote)
      if (sc.url && typeof sc.url === "string") {
        if (sc.url.startsWith("http://") && !sc.url.includes("localhost") && !sc.url.includes("127.0.0.1")) {
          findings.push({
            severity: "medium",
            category: "network",
            message: `MCP server '${name}' uses unencrypted HTTP: ${sc.url}`,
            file: filePath,
          });
        }
      }

      // Check for unpinned npx packages
      if (sc.command === "npx" && Array.isArray(sc.args)) {
        const args = sc.args as string[];
        const hasVersion = args.some((a) => /@\d+\.\d+/.test(a));
        const hasY = args.includes("-y") || args.includes("--yes");
        if (!hasVersion && hasY) {
          findings.push({
            severity: "medium",
            category: "supply-chain",
            message: `MCP server '${name}' uses unpinned npx package (no version specified)`,
            file: filePath,
          });
        }
      }
    }

    // Check for overly permissive tool allowlists
    const permissions = config.permissions;
    if (permissions && typeof permissions === "object") {
      const allow = (permissions as Record<string, unknown>).allow;
      if (Array.isArray(allow)) {
        if (allow.includes("*")) {
          findings.push({
            severity: "high",
            category: "permissions",
            message: "Wildcard '*' in tool allowlist grants unrestricted access",
            file: filePath,
          });
        }
      }
    }
  } catch (error) {
    findings.push({
      severity: "low",
      category: "parsing",
      message: `Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      file: filePath,
    });
  }
}

function scanTextFile(filePath: string, findings: ScanFinding[], source: string): void {
  try {
    const content = readFileSync(filePath, "utf-8");

    const secretPatterns = [
      { pattern: /ghp_[a-zA-Z0-9]{36}/, name: "GitHub Personal Access Token" },
      { pattern: /sk-[a-zA-Z0-9]{48}/, name: "OpenAI API Key" },
      { pattern: /sk-ant-[a-zA-Z0-9-]{93}/, name: "Anthropic API Key" },
      { pattern: /AKIA[0-9A-Z]{16}/, name: "AWS Access Key ID" },
    ];

    for (const { pattern, name } of secretPatterns) {
      if (pattern.test(content)) {
        findings.push({
          severity: "critical",
          category: "secrets",
          message: `Hardcoded ${name} detected in ${source} file`,
          file: filePath,
        });
      }
    }
  } catch {
    // ignore read errors
  }
}

function scanMcpServerPackages(baseDir: string, findings: ScanFinding[]): void {
  // Check for known risky MCP patterns in node_modules or configs
  const dangerousPackages = [
    { pattern: "eval", reason: "Uses eval() - potential code injection" },
    { pattern: "child_process", reason: "Spawns child processes" },
  ];

  // This is a lightweight check - full supply chain analysis would need npm audit
  findings.push({
    severity: "info",
    category: "supply-chain",
    message: "Run 'npm audit' on MCP server packages for full dependency analysis",
  });
}

function scanPolicyFiles(baseDir: string, findings: ScanFinding[]): void {
  const files = readdirSync(baseDir);
  for (const file of files) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    const filePath = join(baseDir, file);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const config = yaml.load(raw) as Record<string, unknown>;

      if (config.version && config.rules) {
        // It's a policy file
        const defaultAction = config.default;
        if (defaultAction === "allow") {
          findings.push({
            severity: "medium",
            category: "policy",
            message: `Policy file '${file}' uses default: allow (consider default: deny for defense in depth)`,
            file: filePath,
          });
        }

        if (!Array.isArray(config.rules) || config.rules.length === 0) {
          findings.push({
            severity: "medium",
            category: "policy",
            message: `Policy file '${file}' has no rules defined`,
            file: filePath,
          });
        }
      }
    } catch {
      // not a valid policy file, skip
    }
  }
}

function scanDirectory(dirPath: string, findings: ScanFinding[], source: string): void {
  try {
    const files = readdirSync(dirPath);
    for (const file of files) {
      const fullPath = join(dirPath, file);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        scanDirectory(fullPath, findings, source);
      } else if (file.endsWith(".md") || file.endsWith(".txt") || file.endsWith(".json")) {
        scanTextFile(fullPath, findings, source);
      }
    }
  } catch {
    // ignore read errors
  }
}

function calculateScore(findings: ScanFinding[]): ScanResult {
  let score = 100;

  for (const finding of findings) {
    switch (finding.severity) {
      case "critical":
        score -= 25;
        break;
      case "high":
        score -= 15;
        break;
      case "medium":
        score -= 5;
        break;
      case "low":
        score -= 2;
        break;
      case "info":
        break;
    }
  }

  score = Math.max(0, score);

  let grade: string;
  if (score >= 90) grade = "A";
  else if (score >= 80) grade = "B";
  else if (score >= 70) grade = "C";
  else if (score >= 60) grade = "D";
  else grade = "F";

  return { findings, score, grade };
}

function printReport(result: ScanResult): void {
  const { findings, score, grade } = result;

  if (findings.length === 0) {
    console.log("No security issues found.");
    return;
  }

  const bySeverity = {
    critical: findings.filter((f) => f.severity === "critical"),
    high: findings.filter((f) => f.severity === "high"),
    medium: findings.filter((f) => f.severity === "medium"),
    low: findings.filter((f) => f.severity === "low"),
    info: findings.filter((f) => f.severity === "info"),
  };

  console.log("Security Scan Results");
  console.log("=".repeat(50));
  console.log(`Score: ${score}/100 (Grade: ${grade})`);
  console.log();

  for (const [severity, items] of Object.entries(bySeverity)) {
    if (items.length === 0) continue;

    const icon = severity === "critical" ? "!!" : severity === "high" ? "! " : "  ";
    console.log(`${icon} [${severity.toUpperCase()}] (${items.length})`);

    for (const item of items) {
      console.log(`    - ${item.message}`);
      if (item.file) console.log(`      File: ${item.file}`);
    }
    console.log();
  }
}
