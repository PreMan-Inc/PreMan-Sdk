import type { PremanClient } from "./client.js";
import type { CallPlatformToolRequest } from "./types.js";

/** HTTP route for platform tool dispatch (POST). */
export const PREMAN_CALL_TOOL_PATH = "/mcp/call-tool" as const;

/** Public platform skill URL — same install path as the dashboard and website. */
export const PREMAN_PLATFORM_SKILL_URL = "https://api.preman.live/skill.md" as const;

/** One-line universal install for coding agents (Cursor, Claude, Codex, LangChain builders). */
export const PREMAN_SKILL_SETUP_COMMAND = `set up ${PREMAN_PLATFORM_SKILL_URL}` as const;

/**
 * Guide for wiring PreMan into custom agentic workflows (LangChain, CrewAI, custom loops).
 * Framework-agnostic — use createPremanAgentTools() and map to your host's tool format.
 */
export const AGENT_WORKFLOWS_GUIDE = `PreMan agentic workflows use HTTP call-tool with a pm_live_… API key.
No MCP stdio server required for programmatic agents.

Quick start:
  import { PremanClient, createPremanAgentTools } from "preman-sdk";
  import { toOpenAITools } from "preman-sdk/platform-tools";

  const client = new PremanClient({ apiKey: process.env.PREMAN_API_KEY });
  const tools = createPremanAgentTools(client);

  // OpenAI / Vercel AI SDK function calling
  const openaiTools = toOpenAITools(tools);
  const handlers = createPremanToolHandlerMap(tools);
  const result = await handlers.preman_discover_capabilities({ query: "find concerts" });

  // LangChain: map each PremanAgentTool to DynamicStructuredTool with tool.invoke

Skill install (IDE agents): ${PREMAN_SKILL_SETUP_COMMAND}

Prefer SDK methods when available (discoverCapabilities, createApp); use callPlatformTool
or createPremanAgentTools for hosts that need a tool catalog + invoke handlers.
`;

export type PremanAgentTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  invoke: (args: Record<string, unknown>) => Promise<unknown>;
};

export type CreatePremanAgentToolsOptions = {
  /** Subset of platform tool names. Defaults to workflow-focused tools. */
  tools?: string[];
};

const WORKFLOW_TOOL_NAMES = [
  "preman_discover_capabilities",
  "preman_list_apps",
  "preman_import_mcp_server",
  "preman_create_app",
  "preman_add_app_member",
  "preman_mint_app_token",
  "mcp_deploy",
  "mcp_list_deployed",
] as const;

type WorkflowToolName = (typeof WORKFLOW_TOOL_NAMES)[number];

const PLATFORM_TOOL_SPECS: Record<WorkflowToolName, { description: string; inputSchema: Record<string, unknown> }> = {
  preman_discover_capabilities: {
    description:
      "Fuzzy search PreMan Apps, templates, and hosted MCPs by natural-language capability. Use before picking a bundle.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language intent, e.g. 'find concerts' or 'plan a hike'" },
        limit: { type: "number", description: "Max results (1-50)", default: 10 },
      },
      required: ["query"],
    },
  },
  preman_list_apps: {
    description: "List Apps (managed MCP profiles) owned by the workspace.",
    inputSchema: { type: "object", properties: {} },
  },
  preman_import_mcp_server: {
    description: "Import a remote MCP URL or pasted MCP config for use as an App member.",
    inputSchema: {
      type: "object",
      properties: {
        mcp_url: { type: "string", description: "Remote MCP URL" },
        config: { type: "object", description: "Cursor/Claude mcpServers JSON" },
        name: { type: "string" },
        initial_secret: { type: "string" },
        initial_secret_type: { type: "string", enum: ["bearer", "api_key", "basic", "custom"] },
      },
    },
  },
  preman_create_app: {
    description:
      "Create an App bundle (e.g. find concerts, plan a hike) with optional template_key and Consumer token.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        slug: { type: "string" },
        template_key: {
          type: "string",
          description: "hike_planner_v1 | concerts_finder_v1 | ecommerce_v1",
        },
        members: { type: "array", items: { type: "object" } },
        mint_consumer_token: { type: "boolean", default: true },
      },
      required: ["name"],
    },
  },
  preman_add_app_member: {
    description: "Attach an imported MCP server or hosted MCP to an App with a tool prefix.",
    inputSchema: {
      type: "object",
      properties: {
        profile_id: { type: "string" },
        server_id: { type: "string" },
        hosted_mcp_id: { type: "string" },
        prefix: { type: "string" },
        display_name: { type: "string" },
      },
      required: ["profile_id", "prefix"],
    },
  },
  preman_mint_app_token: {
    description: "Mint a Consumer token and MCP install snippet for an App runtime.",
    inputSchema: {
      type: "object",
      properties: {
        profile_id: { type: "string" },
        consumer_label: { type: "string", default: "install" },
      },
      required: ["profile_id"],
    },
  },
  mcp_deploy: {
    description: "Deploy a hosted MCP from endpoint definitions and an upstream API URL.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        upstream_base_url: { type: "string" },
        spec: { type: "object" },
        initial_upstream_secret: { type: "string" },
      },
      required: ["name", "upstream_base_url"],
    },
  },
  mcp_list_deployed: {
    description: "List hosted MCPs deployed in the workspace.",
    inputSchema: { type: "object", properties: {} },
  },
};

export function listPlatformToolSpecs(toolNames?: string[]): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  const names = (toolNames ?? [...WORKFLOW_TOOL_NAMES]).filter(
    (name): name is WorkflowToolName => name in PLATFORM_TOOL_SPECS,
  );
  return names.map((name) => ({
    name,
    description: PLATFORM_TOOL_SPECS[name].description,
    inputSchema: PLATFORM_TOOL_SPECS[name].inputSchema,
  }));
}

export function createPremanAgentTools(
  client: PremanClient,
  options: CreatePremanAgentToolsOptions = {},
): PremanAgentTool[] {
  return listPlatformToolSpecs(options.tools).map((spec) => ({
    ...spec,
    invoke: (args) => client.callPlatformTool({ tool: spec.name, arguments: args }),
  }));
}

export function createPremanToolHandlerMap(
  tools: PremanAgentTool[],
): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool.invoke]));
}

/** OpenAI / Vercel AI SDK function tool definitions. */
export function toOpenAITools(tools: PremanAgentTool[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

/** Anthropic Claude tool definitions. */
export function toAnthropicTools(tools: PremanAgentTool[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

export type CallPlatformToolInput = CallPlatformToolRequest;
