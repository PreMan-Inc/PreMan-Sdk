import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_WORKFLOWS_GUIDE,
  PREMAN_CALL_TOOL_PATH,
  PREMAN_PLATFORM_SKILL_URL,
  PREMAN_SKILL_SETUP_COMMAND,
  createPremanAgentTools,
  createPremanToolHandlerMap,
  listPlatformToolSpecs,
  toAnthropicTools,
  toOpenAITools,
} from "../dist/platform-tools.js";
import { PremanClient } from "../dist/index.js";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("skill setup command matches platform skill URL", () => {
  assert.equal(PREMAN_PLATFORM_SKILL_URL, "https://api.preman.live/skill.md");
  assert.equal(PREMAN_SKILL_SETUP_COMMAND, "set up https://api.preman.live/skill.md");
  assert.equal(PREMAN_CALL_TOOL_PATH, "/mcp/call-tool");
});

test("listPlatformToolSpecs includes workflow tools", () => {
  const names = listPlatformToolSpecs().map((t) => t.name);
  for (const toolName of [
    "preman_discover_capabilities",
    "preman_create_app",
    "preman_add_app_member",
    "preman_mint_app_token",
    "mcp_deploy",
  ]) {
    assert.ok(names.includes(toolName), `missing workflow tool ${toolName}`);
  }
});

test("callPlatformTool posts to /mcp/call-tool", async () => {
  const apiKey = "pm_live_12345678901234567890123456789012";
  const calls = [];
  const client = new PremanClient({
    apiKey,
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        method: init.method,
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      return jsonResponse({ apps: [], total: 0 });
    },
  });

  const result = await client.callPlatformTool({
    tool: "preman_list_apps",
    arguments: { limit: 5 },
  });

  assert.equal(calls[0].url, `https://api.preman.live${PREMAN_CALL_TOOL_PATH}`);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.tool, "preman_list_apps");
  assert.deepEqual(calls[0].body.arguments, { limit: 5 });
  assert.equal(calls[0].headers.Authorization, `Bearer ${apiKey}`);
  assert.deepEqual(result.result, { apps: [], total: 0 });
});

test("createPremanAgentTools wires invoke to callPlatformTool", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body));
      return jsonResponse({ results: [{ template_key: "concerts_finder_v1" }] });
    },
  });

  const tools = createPremanAgentTools(client, {
    tools: ["preman_discover_capabilities", "preman_create_app"],
  });
  assert.equal(tools.length, 2);
  assert.deepEqual(
    tools.map((t) => t.name),
    ["preman_discover_capabilities", "preman_create_app"],
  );

  const handlers = createPremanToolHandlerMap(tools);
  const discover = await handlers.preman_discover_capabilities({ query: "find concerts" });
  assert.ok(discover);
  assert.equal(calls[0].tool, "preman_discover_capabilities");
  assert.deepEqual(calls[0].arguments, { query: "find concerts" });

  const create = await handlers.preman_create_app({
    name: "concerts",
    template_key: "concerts_finder_v1",
  });
  assert.ok(create);
  assert.equal(calls[1].tool, "preman_create_app");
  assert.deepEqual(calls[1].arguments, {
    name: "concerts",
    template_key: "concerts_finder_v1",
  });
});

test("PremanAgentTool shape supports LangChain invoke wiring", async () => {
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async () => jsonResponse({ ok: true }),
  });

  const tools = createPremanAgentTools(client);
  assert.ok(tools.length > 0, "default tool set should not be empty");

  for (const tool of tools) {
    assert.equal(typeof tool.name, "string");
    assert.equal(typeof tool.description, "string");
    assert.equal(typeof tool.invoke, "function");
    assert.equal(tool.inputSchema.type, "object");
  }

  const result = await tools[0].invoke({});
  assert.equal(result.tool, tools[0].name);
  assert.deepEqual(result.result, { ok: true });
});

test("toOpenAITools and toAnthropicTools map schemas", () => {
  const tools = listPlatformToolSpecs(["preman_create_app"]).map((spec) => ({
    ...spec,
    invoke: async () => ({}),
  }));
  const openai = toOpenAITools(tools);
  assert.equal(openai[0].type, "function");
  assert.equal(openai[0].function.name, "preman_create_app");
  assert.equal(openai[0].function.parameters.type, "object");

  const anthropic = toAnthropicTools(tools);
  assert.equal(anthropic[0].name, "preman_create_app");
  assert.equal(anthropic[0].input_schema.type, "object");
});

test("main package re-exports workflow helpers", async () => {
  const main = await import("../dist/index.js");
  assert.equal(main.PREMAN_SKILL_SETUP_COMMAND, PREMAN_SKILL_SETUP_COMMAND);
  assert.equal(typeof main.createPremanAgentTools, "function");
  assert.equal(typeof main.toOpenAITools, "function");
  assert.equal(typeof main.PremanClient.prototype.callPlatformTool, "function");
});

test("AGENT_WORKFLOWS_GUIDE documents platform-agnostic workflow", () => {
  assert.match(AGENT_WORKFLOWS_GUIDE, /createPremanAgentTools/);
  assert.match(AGENT_WORKFLOWS_GUIDE, /LangChain/);
  assert.match(AGENT_WORKFLOWS_GUIDE, /skill\.md/);
});
