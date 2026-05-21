import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PolicyEngine, type PolicyConfig, type ToolCallContext } from "@ymstar/opengate-core";
import { loadPolicyFile } from "../config/loader.js";

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id?: string;
}

export function hookCommand(options: { policy: string }): void {
  const policyPath = resolve(options.policy);

  let policy: PolicyConfig;
  try {
    policy = loadPolicyFile(policyPath);
  } catch (error) {
    console.error(`Failed to load policy: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const engine = new PolicyEngine(policy);

  // Read hook input from stdin (Claude Code passes JSON via stdin for hooks)
  let input = "";
  try {
    input = readFileSync(0, "utf-8");
  } catch {
    // No stdin available
    process.exit(0);
  }

  let hookInput: HookInput;
  try {
    hookInput = JSON.parse(input) as HookInput;
  } catch {
    // Invalid JSON, allow by default
    process.exit(0);
  }

  const ctx: ToolCallContext = {
    toolName: hookInput.tool_name,
    arguments: hookInput.tool_input,
    serverName: "claude-code",
    timestamp: Date.now(),
  };

  const decision = engine.evaluate(ctx);

  switch (decision.action) {
    case "allow":
      // Exit 0 = allow
      process.exit(0);
      break;

    case "block":
      // Exit 2 = block with reason
      process.stderr.write(`[OpenGate] BLOCKED: ${decision.reason}\n`);
      process.exit(2);
      break;

    case "require-approval":
      // For hooks, require-approval means block and ask user to approve manually
      process.stderr.write(`[OpenGate] APPROVAL REQUIRED: ${decision.reason}\n`);
      process.stderr.write(`  Tool: ${hookInput.tool_name}\n`);
      process.stderr.write(`  Arguments: ${JSON.stringify(hookInput.tool_input, null, 2)}\n`);
      process.exit(2);
      break;
  }
}
