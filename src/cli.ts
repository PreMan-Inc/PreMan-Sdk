#!/usr/bin/env node
import { readFile } from "fs/promises";
import { PremanClient } from "./client.js";
import { readConfig, writeConfig } from "./config.js";
import { isLocalUpstreamUrl, localUpstreamMessage } from "./upstream.js";
import type { EndpointDefinition } from "./types.js";

type Command = "init" | "register" | "deploy" | "token" | "status" | "help";
const VERSION = "0.2.1";

async function main(): Promise<void> {
  const [, , rawCommand = "help", ...args] = process.argv;
  if (rawCommand === "--version" || rawCommand === "-v" || rawCommand === "version") {
    console.log(VERSION);
    return;
  }
  if (rawCommand === "help" || rawCommand === "--help" || rawCommand === "-h") {
    printHelp();
    return;
  }
  const command = rawCommand as Command;

  if (command === "init") {
    const apiKey = valueFor(args, "--api-key") ?? process.env["PREMAN_API_KEY"] ?? process.env["OPENTEST_API_KEY"];
    const apiUrl = valueFor(args, "--api-url") ?? process.env["PREMAN_API_URL"];
    const appUrl = valueFor(args, "--app-url") ?? process.env["PREMAN_APP_URL"];
    const config = await writeConfig(omitUndefined({ apiKey, apiUrl, appUrl }));
    console.log(`PreMan config saved. Dashboard: ${config.appUrl}`);
    return;
  }

  const config = await readConfig();
  const client = new PremanClient(omitUndefined({
    apiKey: process.env["PREMAN_API_KEY"] ?? process.env["OPENTEST_API_KEY"] ?? config.apiKey,
    apiUrl: process.env["PREMAN_API_URL"] ?? config.apiUrl,
    appUrl: process.env["PREMAN_APP_URL"] ?? config.appUrl,
  }));

  if (command === "status") {
    console.log(JSON.stringify({
      apiUrl: client.apiUrl,
      appUrl: client.appUrl,
      dashboardUrl: client.dashboardUrl(),
    }, null, 2));
    return;
  }

  if (command === "register") {
    const file = valueFor(args, "--file");
    if (!file) throw new Error("register requires --file endpoints.json");
    const endpoints = JSON.parse(await readFile(file, "utf8")) as EndpointDefinition[];
    const result = await client.registerEndpoints(omitUndefined({
      sessionId: valueFor(args, "--session-id"),
      projectId: valueFor(args, "--project-id"),
      upstreamBaseUrl: valueFor(args, "--upstream"),
      intent: valueFor(args, "--intent"),
      endpoints,
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "deploy") {
    const name = valueFor(args, "--name") ?? "Generated MCP";
    const upstreamBaseUrl = valueFor(args, "--upstream");
    const file = valueFor(args, "--file");
    if (!upstreamBaseUrl) throw new Error("deploy requires --upstream https://api.example.com");
    if (isLocalUpstreamUrl(upstreamBaseUrl) && !hasFlag(args, "--allow-local")) {
      throw new Error(localUpstreamMessage(upstreamBaseUrl));
    }
    if (!file) throw new Error("deploy requires --file endpoints.json");
    const endpoints = JSON.parse(await readFile(file, "utf8")) as EndpointDefinition[];
    const result = await client.deployMcp(omitUndefined({
      name,
      upstreamBaseUrl,
      sessionId: valueFor(args, "--session-id"),
      endpoints,
      initialUpstreamSecret: valueFor(args, "--upstream-secret"),
      initialUpstreamSecretType: valueFor(args, "--upstream-secret-type") as "bearer" | "api_key" | "basic" | "custom" | undefined,
      initialConsumerLabel: valueFor(args, "--consumer-label") ?? "default-consumer",
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "token") {
    const mcpId = valueFor(args, "--mcp-id");
    const scopes = valueFor(args, "--scopes")?.split(",").map((s) => s.trim()).filter(Boolean);
    if (!mcpId) throw new Error("token requires --mcp-id mcp_...");
    if (!scopes?.length) throw new Error("token requires --scopes read:users,write:orders");
    const result = await client.createToken(omitUndefined({
      mcpId,
      scopes,
      agentId: valueFor(args, "--agent-id"),
      customerId: valueFor(args, "--customer-id"),
      label: valueFor(args, "--label"),
      consumerLabel: valueFor(args, "--consumer-label"),
      ttlSeconds: numberFor(args, "--ttl"),
      maxToolCalls: numberFor(args, "--max-calls"),
      rateLimitRpm: numberFor(args, "--rate-limit-rpm"),
      upstreamCredentialId: valueFor(args, "--upstream-credential-id"),
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function numberFor(args: string[], flag: string): number | undefined {
  const value = valueFor(args, flag);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function printHelp(): void {
  console.log(`PreMan SDK CLI

Usage:
  npx preman-sdk init --api-key ot_live_...
  npx preman-sdk register --file endpoints.json --upstream https://api.example.com --intent "Auth endpoints"
  npx preman-sdk deploy --name "Auth MCP" --file endpoints.json --upstream https://api.example.com
  npx preman-sdk token --mcp-id mcp_123 --consumer-label cursor-agent --scopes auth:login --rate-limit-rpm 60
  npx preman-sdk status

Global install:
  npm install -g preman-sdk
  preman status

Options:
  --api-url                 Override API URL (default: https://flow.opentest.live)
  --app-url                 Override app URL (default: https://www.flowtest.opentest.live)
  --upstream                Your real API base URL. Example: https://api.company.com
  --allow-local             Allow localhost/private upstreams for local-only previews
  --session-id              Reuse a Flow playground session id
  --upstream-secret         Upstream API secret stored with a hosted MCP deploy
  --consumer-label          Initial consumer token label (default: default-consumer)
  --version                 Print CLI version

Auth:
  The CLI uses your OpenTest workspace API key, currently formatted as ot_live_...
  Create one at https://www.flowtest.opentest.live/settings.
  You can save it with init or set PREMAN_API_KEY / OPENTEST_API_KEY.

Upstream:
  PreMan combines --upstream with each endpoint path.
  Example: --upstream https://api.company.com + /auth/login = https://api.company.com/auth/login
  Do not use a marketing site unless that site is also your API.
  localhost only works for local testing; hosted MCPs need a deployed or tunneled API URL.

The CLI is the on-ramp. Use the hosted workspace at https://www.flowtest.opentest.live
to see customer tokens, revoke access, inspect audit logs, and review agent activity.
`);
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
