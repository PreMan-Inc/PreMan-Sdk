import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_APPS_GUIDE,
  appLlmsTxtUrl,
  appRuntimeUrl,
  normalizeDiscoveredCapability,
} from "../dist/apps.js";
import { PremanClient } from "../dist/index.js";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("app URL helpers", () => {
  assert.equal(appRuntimeUrl("https://api.preman.live", "my-hikes"), "https://api.preman.live/m/my-hikes/mcp");
  assert.equal(appLlmsTxtUrl("https://api.preman.live/", "concerts"), "https://api.preman.live/m/concerts/llms.txt");
});

test("normalizeDiscoveredCapability reads _capability payload", () => {
  const match = normalizeDiscoveredCapability({
    name: "template:hike_planner_v1",
    _capability: {
      kind: "template",
      id: "hike_planner_v1",
      name: "Hike Planner",
      summary_snippet: "Trail search and weather",
      template_key: "hike_planner_v1",
      install_hint: "Create with template_key",
    },
  });
  assert.equal(match.kind, "template");
  assert.equal(match.templateKey, "hike_planner_v1");
  assert.equal(match.name, "Hike Planner");
});

test("discoverCapabilities searches by intent", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({
        query: "find concerts",
        total: 1,
        matches: [
          {
            name: "template:concerts_finder_v1",
            _capability: {
              kind: "template",
              id: "concerts_finder_v1",
              name: "Concerts Finder",
              template_key: "concerts_finder_v1",
            },
          },
        ],
      });
    },
  });

  const result = await client.discoverCapabilities({ query: "find concerts", limit: 5 });
  assert.match(calls[0], /\/capabilities\/search\?/);
  assert.equal(result.matches[0].templateKey, "concerts_finder_v1");
});

test("createApp posts to managed-mcps profiles", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return jsonResponse({
        profile: { id: "prof_1", name: "My Concerts", slug: "my-concerts", status: "active" },
        raw_token: "pm_hmcp_test",
        install_snippet: {
          url: "https://api.preman.live/m/my-concerts/mcp",
          mcp_json: { mcpServers: {} },
        },
      });
    },
  });

  const result = await client.createApp({
    name: "My Concerts",
    templateKey: "concerts_finder_v1",
  });

  assert.equal(calls[0].url, "https://api.preman.live/managed-mcps/profiles");
  assert.equal(calls[0].body.template_key, "concerts_finder_v1");
  assert.equal(result.profile.slug, "my-concerts");
  assert.equal(result.runtimeUrl, "https://api.preman.live/m/my-concerts/mcp");
  assert.match(result.dashboardUrl, /\/apps\/prof_1$/);
});

test("listApps reads dashboard apps route", async () => {
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://api.preman.live/apps");
      return jsonResponse({ apps: [{ id: "a1", name: "Hikes", slug: "hikes", status: "active" }], total: 1 });
    },
  });
  const result = await client.listApps();
  assert.equal(result.total, 1);
  assert.equal(result.apps[0].slug, "hikes");
});

test("AGENT_APPS_GUIDE documents builder and consumer flows", () => {
  assert.match(AGENT_APPS_GUIDE, /discoverCapabilities/);
  assert.match(AGENT_APPS_GUIDE, /concerts_finder_v1/);
  assert.match(AGENT_APPS_GUIDE, /get_setup_status/);
});
