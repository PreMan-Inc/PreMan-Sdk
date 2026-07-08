import assert from "node:assert/strict";
import test from "node:test";
import {
  apifyActorIdFromUpstream,
  generateHostedMcpLlmsTxt,
  hostedMcpLlmsTxtUrl,
  isApifyHostedMcp,
  stripApifyNamePrefix,
} from "../dist/llms.js";

test("stripApifyNamePrefix removes legacy prefix", () => {
  assert.equal(stripApifyNamePrefix("Apify: Google Maps"), "Google Maps");
  assert.equal(stripApifyNamePrefix("Google Maps"), "Google Maps");
});

test("isApifyHostedMcp detects Apify upstream", () => {
  assert.equal(
    isApifyHostedMcp({
      name: "Google Maps",
      upstream_base_url: "https://mcp.apify.com?tools=compass/google-maps",
    }),
    true,
  );
  assert.equal(isApifyHostedMcp({ name: "Apify: Foo", upstream_base_url: "" }), true);
  assert.equal(isApifyHostedMcp({ name: "Other", upstream_base_url: "https://api.example.com" }), false);
});

test("apifyActorIdFromUpstream parses tools param", () => {
  assert.equal(
    apifyActorIdFromUpstream("https://mcp.apify.com?tools=compass/google-maps"),
    "compass/google-maps",
  );
});

test("generateHostedMcpLlmsTxt includes spec sections", () => {
  const body = generateHostedMcpLlmsTxt({
    name: "Apify: Google Maps Scraper",
    mcpId: "mcp-1",
    apiUrl: "https://api-dev.preman.live",
    appUrl: "https://app.preman.live",
    upstreamBaseUrl: "https://mcp.apify.com?tools=compass/google-maps",
    tools: [{ name: "run_actor", description: "Run the actor" }],
  });
  assert.match(body, /^# Google Maps Scraper/m);
  assert.match(body, /> PreMan hosted MCP gateway/);
  assert.match(body, /## Tools/);
  assert.match(body, /`run_actor`/);
  assert.equal(hostedMcpLlmsTxtUrl("https://api-dev.preman.live", "mcp-1"), "https://api-dev.preman.live/h/mcp-1/llms.txt");
  assert.match(body, /https:\/\/api-dev\.preman\.live\/h\/mcp-1\/llms\.txt/);
});
