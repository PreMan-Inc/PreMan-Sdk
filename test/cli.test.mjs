import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const MISSING_KEY_MESSAGE = "Missing API key. Create one at https://app.preman.live/settings, then run `preman init --api-key pm_live_...` or set PREMAN_API_KEY.";

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    cwd: process.cwd(),
    env: { HOME: mkdtempSync(join(tmpdir(), "preman-cli-home-")) },
    encoding: "utf8",
  });
}

function fixtures() {
  const dir = mkdtempSync(join(tmpdir(), "preman-cli-"));
  const endpoints = [{ method: "GET", path: "/health", scope: "health:read" }];
  const files = {
    spec: join(dir, "openapi.json"),
    endpoints: join(dir, "endpoints.json"),
    manifest: join(dir, "preman.config.json"),
    out: join(dir, "imported.json"),
  };
  writeFileSync(files.spec, JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Health", version: "1.0.0" },
    paths: { "/health": { get: { summary: "Health check", responses: { "200": { description: "ok" } } } } },
  }));
  writeFileSync(files.endpoints, JSON.stringify(endpoints));
  writeFileSync(files.manifest, JSON.stringify({ name: "Health MCP", upstream: "https://api.example.com", endpoints }));
  return files;
}

test("offline CLI commands run without PREMAN_API_KEY", () => {
  const files = fixtures();
  const commands = [
    ["import", "openapi", "--file", files.spec, "--out", files.out],
    ["typegen", "--file", files.endpoints],
    ["apply", "--file", files.manifest, "--dry-run"],
    ["install-snippet", "--target", "cursor", "--url", "https://api.example.com/h/mcp_123/mcp", "--token", "pm_hmcp_test"],
  ];

  for (const args of commands) {
    const result = runCli(args);
    assert.equal(`${result.stdout}${result.stderr}`.includes("Missing API key"), false, `${args.join(" ")}: ${result.stderr}`);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
  }
  assert.equal(JSON.parse(readFileSync(files.out, "utf8"))[0].path, "/health");
});

test("unknown CLI command reports the command instead of a missing key", () => {
  const result = runCli(["frobnicate"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "Unknown command: frobnicate");
});

test("CLI commands that call the API still require PREMAN_API_KEY", () => {
  const files = fixtures();
  for (const args of [
    ["status"],
    ["import", "openapi", "--file", files.spec, "--deploy", "--upstream", "https://api.example.com"],
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stderr.trim(), MISSING_KEY_MESSAGE, args.join(" "));
  }
});
