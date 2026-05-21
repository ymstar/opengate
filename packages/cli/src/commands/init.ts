import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_POLICY = `# OpenGate Policy Configuration
# See https://github.com/opengate/opengate for documentation

version: "1"
name: "default-policy"
description: "Default security policy for OpenGate"

# Default action when no rule matches: "allow" or "deny"
default: allow

settings:
  audit:
    enabled: true
    path: "./audit.jsonl"
    format: jsonl
    logArguments: true

rules:
  # Allow read-only tools
  - id: "allow-read-only"
    description: "Allow tools marked as read-only"
    match:
      tool:
        annotations:
          readOnlyHint: true
    action: allow

  # Block destructive shell commands
  - id: "block-destructive-shell"
    description: "Block potentially destructive shell commands"
    match:
      tool:
        name: "Bash"
        arguments:
          command:
            regex: "rm\\s+-rf|mkfs|dd\\s+if=|:\\(\\)\\{.*\\|.*\\|.*&\\}"
    action: block
    reason: "Destructive command detected"

  # Require approval for write operations outside project
  - id: "approve-external-writes"
    description: "Require approval for file writes outside current directory"
    match:
      tool:
        name:
          glob: "Write"
    action: require-approval
    approval:
      timeout: 30
`;

export function initCommand(options: { output?: string }): void {
  const outputPath = resolve(options.output ?? "opengate.yaml");

  if (existsSync(outputPath)) {
    console.error(`Error: File already exists: ${outputPath}`);
    console.error("Use --output to specify a different path, or delete the existing file.");
    process.exit(1);
  }

  writeFileSync(outputPath, DEFAULT_POLICY, "utf-8");
  console.log(`Created policy file: ${outputPath}`);
  console.log("\nNext steps:");
  console.log("  1. Edit opengate.yaml to customize your security policy");
  console.log("  2. Create a config file for each MCP server you want to protect:");
  console.log("     opengate-filesystem.yaml:");
  console.log("       policy: ./opengate.yaml");
  console.log("       server:");
  console.log('         command: "npx"');
  console.log('         args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]');
  console.log("  3. Point your MCP client (e.g. Claude Code) to OpenGate:");
  console.log('       "command": "npx", "args": ["-y", "@ymstar/opengate-cli", "--config", "./opengate-filesystem.yaml"]');
}
