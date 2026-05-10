#!/usr/bin/env node
import { readFile } from "fs/promises";
import { PremanClient } from "./client.js";
import { readConfig, writeConfig } from "./config.js";
import type { EndpointDefinition } from "./types.js";

type Command = "init" | "register" | "deploy" | "token" | "status" | "help";

async function main(): Promise<void> {
  const [, , rawCommand = "help", ...args] = process.argv;
  if (rawCommand === "help" || rawCommand === "--help" || rawCommand === "-h") {
    printHelp();
    return;
  }
  const command = rawCommand as Command;

  if (command === "init") {
    const apiKey = valueFor(args, "--api-key") ?? process.env["PREMAN_API_KEY"];
    const apiUrl = valueFor(args, "--api-url") ?? process.env["PREMAN_API_URL"];
    const appUrl = valueFor(args, "--app-url") ?? process.env["PREMAN_APP_URL"];
    const config = await writeConfig(omitUndefined({ apiKey, apiUrl, appUrl }));
    console.log(`PreMan config saved. Dashboard: ${config.appUrl}`);
    return;
  }

  const config = await readConfig();
  const client = new PremanClient(omitUndefined({
    apiKey: process.env["PREMAN_API_KEY"] ?? config.apiKey,
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
      projectId: valueFor(args, "--project-id"),
      upstreamBaseUrl: valueFor(args, "--upstream"),
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
    if (!file) throw new Error("deploy requires --file endpoints.json");
    const endpoints = JSON.parse(await readFile(file, "utf8")) as EndpointDefinition[];
    const result = await client.deployMcp({ name, upstreamBaseUrl, endpoints });
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
      ttlSeconds: numberFor(args, "--ttl"),
      maxToolCalls: numberFor(args, "--max-calls"),
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

function numberFor(args: string[], flag: string): number | undefined {
  const value = valueFor(args, flag);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function printHelp(): void {
  console.log(`PreMan SDK CLI

Usage:
  preman init --api-key pm_live_...
  preman register --file endpoints.json --upstream https://api.example.com
  preman deploy --name "Auth MCP" --file endpoints.json --upstream https://api.example.com
  preman token --mcp-id mcp_123 --scopes auth:login --ttl 900
  preman status

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
