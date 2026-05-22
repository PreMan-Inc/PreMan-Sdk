import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  generateEndpointTypes,
  generateHostedMcpToolTypes,
  hostedMcpJson,
  installCommand,
  createCatalogSnapshot,
  diffCatalogSnapshots,
  normalizeHostedMcpCatalog,
  previewManifest,
  resolveSecret,
  secretFromEnv,
  writeMcpInstall,
} from "../dist/index.js";

test("manifest preview validates endpoints and policy coverage", () => {
  const plan = previewManifest({
    name: "Auth MCP",
    upstream: "https://api.example.com",
    endpoints: [{ method: "POST", path: "/auth/login", scope: "auth:login" }],
    policies: [{ scope: "auth:login", rateLimitRpm: 60 }],
  });

  assert.equal(plan.valid, true);
  assert.equal(plan.endpointCount, 1);
  assert.deepEqual(plan.scopes, ["auth:login"]);
  assert.deepEqual(plan.warnings, []);
});

test("install snippet writers merge Cursor-style MCP config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "preman-sdk-"));
  const path = join(dir, "mcp.json");
  const result = await writeMcpInstall({
    target: "cursor",
    path,
    serverName: "auth-mcp",
    url: "https://flow.opentest.live/h/mcp_123/mcp",
    token: "ot_hmcp_test",
  });

  const written = JSON.parse(await readFile(path, "utf8"));
  assert.equal(result.wrote, true);
  assert.equal(written.mcpServers["auth-mcp"].headers.Authorization, "Bearer ot_hmcp_test");
  assert.equal(hostedMcpJson({ serverName: "auth-mcp", url: "u", token: "t" }).mcpServers["auth-mcp"].url, "u");
  assert.match(installCommand({ serverName: "auth-mcp", url: "u", token: "t" }, "claude"), /claude mcp add/);
});

test("typegen emits endpoint request and response types", () => {
  const output = generateEndpointTypes([
    {
      method: "POST",
      path: "/auth/login",
      requestBodySchema: {
        type: "object",
        properties: { email: { type: "string" }, password: { type: "string" } },
        required: ["email", "password"],
      },
      responseSchema: {
        type: "object",
        properties: { access_token: { type: "string" } },
        required: ["access_token"],
      },
    },
  ]);

  assert.match(output, /export namespace PremanEndpoints/);
  assert.match(output, /export type PostAuthLoginRequest/);
  assert.match(output, /"access_token": string/);
});

test("typegen emits hosted MCP tool catalog wrappers", () => {
  const catalog = normalizeHostedMcpCatalog({
    hosted_mcp: {
      id: "mcp_123",
      name: "Auth MCP",
      endpoint_selection: {
        tools: [
          {
            name: "post_auth_login",
            description: "Login with email and password.",
            inputSchema: {
              type: "object",
              properties: {
                body: {
                  type: "object",
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string" },
                    mode: { enum: ["password", "sso"] },
                  },
                  required: ["email", "password"],
                  additionalProperties: false,
                },
              },
              required: ["body"],
              additionalProperties: false,
            },
            _endpoint_ref: { method: "POST", path_template: "/auth/login" },
          },
        ],
      },
    },
  });

  const output = generateHostedMcpToolTypes(catalog, { client: true });

  assert.match(output, /export namespace PremanTools/);
  assert.match(output, /export type PostAuthLoginArgs/);
  assert.match(output, /"mode"\?: "password" \| "sso"/);
  assert.match(output, /postAuthLogin: \(args: PostAuthLoginArgs\)/);
});

test("catalog diff blocks removed tools, schema broadening, and new write tools", () => {
  const approved = createCatalogSnapshot(normalizeHostedMcpCatalog({
    endpoint_selection: {
      tools: [
        {
          name: "get_users",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "object",
                properties: { limit: { type: "integer" } },
                required: ["limit"],
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
          _endpoint_ref: { method: "GET", path_template: "/users" },
        },
        {
          name: "delete_user",
          inputSchema: { type: "object", additionalProperties: false },
          _endpoint_ref: { method: "DELETE", path_template: "/users/{id}" },
        },
      ],
    },
  }), new Date("2026-01-01T00:00:00Z"));
  const current = createCatalogSnapshot(normalizeHostedMcpCatalog({
    endpoint_selection: {
      tools: [
        {
          name: "get_users",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "object",
                properties: { limit: { type: "integer" } },
                additionalProperties: true,
              },
            },
            additionalProperties: false,
          },
          _endpoint_ref: { method: "GET", path_template: "/users" },
        },
        {
          name: "post_users",
          inputSchema: { type: "object", additionalProperties: false },
          _endpoint_ref: { method: "POST", path_template: "/users" },
        },
      ],
    },
  }), new Date("2026-01-01T00:00:00Z"));

  const diff = diffCatalogSnapshots(approved, current);
  assert.deepEqual(diff.blocking.map((finding) => finding.code).sort(), [
    "new_write_tool",
    "removed_tool",
    "schema_broadened",
  ]);
});

test("secret providers read environment values", async () => {
  process.env.PREMAN_TEST_SECRET = "secret-value";
  try {
    assert.equal(await resolveSecret(secretFromEnv("PREMAN_TEST_SECRET")), "secret-value");
    assert.equal(await resolveSecret({ type: "inline", value: "inline-secret" }), "inline-secret");
  } finally {
    delete process.env.PREMAN_TEST_SECRET;
  }
});
