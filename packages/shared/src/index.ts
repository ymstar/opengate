export const VERSION = "0.3.0";

export const JSONRPC_VERSION = "2.0" as const;

export const MCP_METHODS = {
  INITIALIZE: "initialize",
  PING: "ping",
  TOOLS_LIST: "tools/list",
  TOOLS_CALL: "tools/call",
  RESOURCES_LIST: "resources/list",
  RESOURCES_READ: "resources/read",
  RESOURCES_SUBSCRIBE: "resources/subscribe",
  RESOURCES_UNSUBSCRIBE: "resources/unsubscribe",
  PROMPTS_LIST: "prompts/list",
  PROMPTS_GET: "prompts/get",
  COMPLETION_COMPLETE: "completion/complete",
  LOGGING_SET_LEVEL: "logging/setLevel",
  NOTIFICATIONS_INITIALIZED: "notifications/initialized",
  NOTIFICATIONS_TOOLS_LIST_CHANGED: "notifications/tools/list_changed",
  NOTIFICATIONS_RESOURCES_LIST_CHANGED: "notifications/resources/list_changed",
  NOTIFICATIONS_PROMPTS_LIST_CHANGED: "notifications/prompts/list_changed",
} as const;

export type McpMethod = (typeof MCP_METHODS)[keyof typeof MCP_METHODS];
