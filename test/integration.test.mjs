import assert from "node:assert/strict";
import test from "node:test";
import { PremanClient } from "../dist/index.js";

const enabled = process.env.PREMAN_INTEGRATION === "1";
const apiKey = process.env.PREMAN_API_KEY;
const apiUrl = process.env.PREMAN_API_URL;
const docsUrl = process.env.PREMAN_TEST_OPENAPI_URL ?? "https://petstore3.swagger.io/api/v3/openapi.json";
const remoteMcpUrl = process.env.PREMAN_TEST_REMOTE_MCP_URL;

function integrationClient() {
  return new PremanClient({
    apiKey,
    apiUrl,
    timeoutMs: 60_000,
    retry: { retries: 1, retryUnsafe: true },
  });
}

test("integration: import docs preview catches staging response drift", { skip: !enabled || !apiKey }, async () => {
  const client = integrationClient();
  const result = await client.importFromDocs({
    docsUrl,
    deploy: false,
    maxEndpoints: 20,
    request: { idempotencyKey: `integration-docs-${Date.now()}` },
  });

  assert.ok(result.preview, "expected preview object");
  assert.ok(result.generatedSpec, "expected generated_spec object");
  assert.ok(Number(result.preview.tool_count ?? 0) > 0, "expected discovered tools");
});

test("integration: remote MCP import catches staging response drift", { skip: !enabled || !apiKey || !remoteMcpUrl }, async () => {
  const client = integrationClient();
  const result = await client.importRemoteMcp({
    mcpUrl: remoteMcpUrl,
    request: { idempotencyKey: `integration-remote-${Date.now()}` },
  });

  assert.ok(result.preview ?? result.generatedSpec ?? result.hostedMcp, "expected remote MCP import payload");
});

test("integration: hosted MCP list/detail normalization", { skip: !enabled || !apiKey }, async () => {
  const client = integrationClient();
  const list = await client.listHostedMcps();
  assert.ok(Array.isArray(list.hostedMcps), "expected hosted MCP array");

  if (list.hostedMcps.length === 0) return;
  const id = String(list.hostedMcps[0].id ?? "");
  assert.ok(id, "expected hosted MCP id");
  const detail = await client.getHostedMcp(id);
  assert.equal(detail.hostedMcp.id, id);
});
