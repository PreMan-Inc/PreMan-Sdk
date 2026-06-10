#!/usr/bin/env node
import { readFile, writeFile } from "fs/promises";
import {
  createCatalogSnapshot,
  diffCatalogSnapshots,
  formatCatalogDiff,
  normalizeHostedMcpCatalog,
  parseCatalogSnapshot,
} from "./catalog.js";
import { PremanClient } from "./client.js";
import { readConfig, writeConfig } from "./config.js";
import { fromOpenApi, fromPostmanCollection } from "./importers.js";
import { installCommand, writeMcpInstall, type McpInstallTarget } from "./installers.js";
import { previewManifest, readManifest } from "./manifest.js";
import { resolveSecret, secretFromEnv } from "./secrets.js";
import { runLocalStdioTunnel } from "./tunnel.js";
import { generateEndpointTypes, generateHostedMcpToolTypes } from "./typegen.js";
import { isLocalUpstreamUrl, localUpstreamMessage } from "./upstream.js";
import type { EndpointDefinition } from "./types.js";

type Command =
  | "init"
  | "register"
  | "deploy"
  | "import-docs"
  | "import-remote-mcp"
  | "tunnel"
  | "hosted-mcps"
  | "token"
  | "tokens"
  | "status"
  | "import"
  | "apply"
  | "install-snippet"
  | "snapshot"
  | "diff"
  | "typegen"
  | "help";
const VERSION = "0.3.0";

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
    const endpoints = await endpointsFromRequiredFile(args, "register");
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
    const upstreamBaseUrl = requiredValue(args, "--upstream", "deploy requires --upstream https://api.example.com");
    if (isLocalUpstreamUrl(upstreamBaseUrl) && !hasFlag(args, "--allow-local")) {
      throw new Error(localUpstreamMessage(upstreamBaseUrl));
    }
    const endpoints = await endpointsFromRequiredFile(args, "deploy");
    const result = await client.deployMcp(omitUndefined({
      name,
      upstreamBaseUrl,
      sessionId: valueFor(args, "--session-id"),
      endpoints,
      initialUpstreamSecret: await upstreamSecretFor(args),
      initialUpstreamSecretType: valueFor(args, "--upstream-secret-type") as "bearer" | "api_key" | "basic" | "custom" | undefined,
      initialConsumerLabel: valueFor(args, "--consumer-label") ?? "default-consumer",
      request: { idempotencyKey: valueFor(args, "--idempotency-key") },
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "import-docs") {
    const docsUrl = requiredValue(args, "--url", "import-docs requires --url https://docs.example.com/api");
    const upstreamBaseUrl = valueFor(args, "--upstream");
    if (upstreamBaseUrl && isLocalUpstreamUrl(upstreamBaseUrl) && !hasFlag(args, "--allow-local")) {
      throw new Error(localUpstreamMessage(upstreamBaseUrl));
    }
    const result = await client.importFromDocs(omitUndefined({
      docsUrl,
      name: valueFor(args, "--name"),
      slug: valueFor(args, "--slug"),
      upstreamBaseUrl,
      upstreamAuthStyle: upstreamAuthStyleFor(args),
      initialUpstreamSecret: await upstreamSecretFor(args),
      initialUpstreamSecretType: upstreamSecretTypeFor(args),
      accessMode: accessModeFor(args),
      maxEndpoints: numberFor(args, "--max-endpoints"),
      deploy: !hasFlag(args, "--preview"),
      request: { idempotencyKey: valueFor(args, "--idempotency-key") },
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "import-remote-mcp") {
    const result = await client.importRemoteMcp(omitUndefined({
      mcpUrl: requiredValue(args, "--url", "import-remote-mcp requires --url https://mcp.example.com/mcp"),
      name: valueFor(args, "--name"),
      slug: valueFor(args, "--slug"),
      upstreamAuthStyle: upstreamAuthStyleFor(args),
      initialUpstreamSecret: await upstreamSecretFor(args),
      initialUpstreamSecretType: upstreamSecretTypeFor(args),
      accessMode: accessModeFor(args),
      request: { idempotencyKey: valueFor(args, "--idempotency-key") },
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "tunnel") {
    await handleTunnelCommand(args, client);
    return;
  }

  if (command === "hosted-mcps") {
    const id = valueFor(args, "--id") ?? valueFor(args, "--mcp-id");
    console.log(JSON.stringify(id ? await client.getHostedMcp(id) : await client.listHostedMcps(), null, 2));
    return;
  }

  if (command === "token") {
    await handleTokenCommand(args, client);
    return;
  }

  if (command === "tokens") {
    const mcpId = requiredValue(args, "--mcp-id", "tokens requires --mcp-id mcp_...");
    console.log(JSON.stringify(await client.listTokens({ mcpId, includeRevoked: hasFlag(args, "--include-revoked") }), null, 2));
    return;
  }

  if (command === "import") {
    await handleImportCommand(args, client);
    return;
  }

  if (command === "apply") {
    await handleApplyCommand(args, client);
    return;
  }

  if (command === "install-snippet") {
    await handleInstallSnippetCommand(args);
    return;
  }

  if (command === "snapshot") {
    await handleSnapshotCommand(args, client);
    return;
  }

  if (command === "diff") {
    await handleDiffCommand(args, client);
    return;
  }

  if (command === "typegen") {
    const mcpId = valueFor(args, "--mcp-id");
    const text = mcpId
      ? generateHostedMcpToolTypes((await client.getHostedMcpCatalog(mcpId)).catalog, {
        namespace: valueFor(args, "--namespace"),
        client: hasFlag(args, "--client"),
      })
      : generateEndpointTypes(await endpointsFromRequiredFile(args, "typegen"), { namespace: valueFor(args, "--namespace") });
    const out = valueFor(args, "--out");
    if (out) {
      await writeFile(out, text);
      console.log(`Wrote ${out}`);
    } else {
      console.log(text);
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function handleSnapshotCommand(args: string[], client: PremanClient): Promise<void> {
  const current = await currentCatalogSnapshot(args, client);
  const text = `${JSON.stringify(current, null, 2)}\n`;
  const out = valueFor(args, "--out");
  if (out) {
    await writeFile(out, text);
    console.log(`Wrote ${out}`);
    return;
  }
  console.log(text);
}

async function handleDiffCommand(args: string[], client: PremanClient): Promise<void> {
  const approvedFile = requiredValue(args, "--approved", "diff requires --approved preman-catalog.snapshot.json");
  const approved = parseCatalogSnapshot(await readFile(approvedFile, "utf8"));
  const current = await currentCatalogSnapshot(args, client);
  const diff = diffCatalogSnapshots(approved, current, {
    allowRemovedTools: hasFlag(args, "--allow-removed-tools"),
    allowRenamedTools: hasFlag(args, "--allow-renamed-tools"),
    allowRiskySchemaBroadening: hasFlag(args, "--allow-schema-broadening"),
    allowNewWriteTools: hasFlag(args, "--allow-new-write-tools"),
  });
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(diff, null, 2));
  } else {
    console.log(formatCatalogDiff(diff));
  }
  if (diff.blocking.length) {
    process.exitCode = 1;
  }
}

async function currentCatalogSnapshot(args: string[], client: PremanClient) {
  const mcpId = valueFor(args, "--mcp-id");
  if (mcpId) {
    return createCatalogSnapshot((await client.getHostedMcpCatalog(mcpId)).catalog);
  }

  const docsUrl = valueFor(args, "--url") ?? valueFor(args, "--docs-url");
  if (docsUrl) {
    const preview = await client.importFromDocs(omitUndefined({
      docsUrl,
      name: valueFor(args, "--name"),
      upstreamBaseUrl: valueFor(args, "--upstream"),
      maxEndpoints: numberFor(args, "--max-endpoints"),
      deploy: false,
    }));
    const catalog = normalizeHostedMcpCatalog({
      name: preview.name,
      generated_spec: preview.generatedSpec,
    });
    return createCatalogSnapshot(catalog);
  }

  const file = valueFor(args, "--file");
  if (file) {
    return parseCatalogSnapshot(await readFile(file, "utf8"));
  }

  throw new Error("Provide --mcp-id, --url, or --file.");
}

async function handleTokenCommand(args: string[], client: PremanClient): Promise<void> {
  const action = args[0];
  if (action === "list") {
    const mcpId = requiredValue(args, "--mcp-id", "token list requires --mcp-id mcp_...");
    console.log(JSON.stringify(await client.listTokens({ mcpId, includeRevoked: hasFlag(args, "--include-revoked") }), null, 2));
    return;
  }
  if (action === "revoke") {
    const mcpId = requiredValue(args, "--mcp-id", "token revoke requires --mcp-id mcp_...");
    const tokenId = requiredValue(args, "--token-id", "token revoke requires --token-id token_...");
    console.log(JSON.stringify(await client.revokeToken({ mcpId, tokenId }), null, 2));
    return;
  }
  if (action === "rotate") {
    const mcpId = requiredValue(args, "--mcp-id", "token rotate requires --mcp-id mcp_...");
    const tokenId = requiredValue(args, "--token-id", "token rotate requires --token-id token_...");
    const scopes = scopesFor(args, "token rotate");
    console.log(JSON.stringify(await client.rotateToken(omitUndefined({
      mcpId,
      tokenId,
      scopes,
      consumerLabel: valueFor(args, "--consumer-label"),
      rateLimitRpm: numberFor(args, "--rate-limit-rpm"),
      request: { idempotencyKey: valueFor(args, "--idempotency-key") },
    })), null, 2));
    return;
  }

  const mcpId = requiredValue(args, "--mcp-id", "token requires --mcp-id mcp_...");
  const scopes = scopesFor(args, "token");
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
    request: { idempotencyKey: valueFor(args, "--idempotency-key") },
  }));
  console.log(JSON.stringify(result, null, 2));
}

async function handleImportCommand(args: string[], client: PremanClient): Promise<void> {
  const kind = args[0];
  const file = requiredValue(args, "--file", "import requires --file spec.json");
  const raw = await readFile(file, "utf8");
  const endpoints = kind === "openapi"
    ? fromOpenApi(raw)
    : kind === "postman"
      ? fromPostmanCollection(raw)
      : undefined;
  if (!endpoints) throw new Error("import requires subcommand: openapi or postman");

  const out = valueFor(args, "--out");
  const text = JSON.stringify(endpoints, null, 2);
  if (out) await writeFile(out, `${text}\n`);

  if (hasFlag(args, "--deploy")) {
    const upstreamBaseUrl = requiredValue(args, "--upstream", "import --deploy requires --upstream https://api.example.com");
    if (isLocalUpstreamUrl(upstreamBaseUrl) && !hasFlag(args, "--allow-local")) throw new Error(localUpstreamMessage(upstreamBaseUrl));
    console.log(JSON.stringify(await client.deployMcp({
      name: valueFor(args, "--name") ?? "Imported MCP",
      upstreamBaseUrl,
      endpoints,
      request: { idempotencyKey: valueFor(args, "--idempotency-key") },
    }), null, 2));
    return;
  }

  if (hasFlag(args, "--register")) {
    console.log(JSON.stringify(await client.registerEndpoints({
      upstreamBaseUrl: valueFor(args, "--upstream"),
      intent: valueFor(args, "--intent") ?? `Imported ${kind} endpoints`,
      endpoints,
    }), null, 2));
    return;
  }

  console.log(text);
}

async function handleApplyCommand(args: string[], client: PremanClient): Promise<void> {
  const file = requiredValue(args, "--file", "apply requires --file preman.config.json");
  const manifest = await readManifest(file);
  const plan = previewManifest(manifest);
  if (hasFlag(args, "--dry-run")) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (!plan.valid) throw new Error(`Invalid manifest: ${plan.errors.join("; ")}`);
  const session = await client.registerEndpoints({
    upstreamBaseUrl: manifest.upstream,
    intent: manifest.intent,
    endpoints: manifest.endpoints,
  });
  const shouldDeploy = hasFlag(args, "--deploy") || Boolean(manifest.deploy);
  if (!shouldDeploy) {
    console.log(JSON.stringify({ plan, session }, null, 2));
    return;
  }
  if (isLocalUpstreamUrl(manifest.upstream) && !hasFlag(args, "--allow-local")) throw new Error(localUpstreamMessage(manifest.upstream));
  const deploy = await client.deployMcp({
    sessionId: session.sessionId,
    name: manifest.deploy?.name ?? manifest.name ?? "Manifest MCP",
    upstreamBaseUrl: manifest.upstream,
    endpoints: manifest.endpoints,
    initialConsumerLabel: manifest.deploy?.initialConsumerLabel ?? "default-consumer",
    request: { idempotencyKey: valueFor(args, "--idempotency-key") },
  });
  console.log(JSON.stringify({ plan, session, deploy }, null, 2));
}

async function handleInstallSnippetCommand(args: string[]): Promise<void> {
  const target = (valueFor(args, "--target") ?? "cursor") as McpInstallTarget;
  const serverName = valueFor(args, "--server-name") ?? valueFor(args, "--name") ?? "preman-hosted-mcp";
  const url = requiredValue(args, "--url", "install-snippet requires --url https://api.preman.live/h/.../mcp");
  const token = valueFor(args, "--token") ?? await resolveSecret(valueFor(args, "--token-env") ? secretFromEnv(valueFor(args, "--token-env") as string) : undefined);
  if (!token) throw new Error("install-snippet requires --token pm_hmcp_... or --token-env TOKEN_VAR");
  if (hasFlag(args, "--write")) {
    console.log(JSON.stringify(await writeMcpInstall({
      target,
      serverName,
      url,
      token,
      path: valueFor(args, "--path"),
      dryRun: hasFlag(args, "--dry-run"),
    }), null, 2));
    return;
  }
  console.log(installCommand({ serverName, url, token }, target));
}

async function handleTunnelCommand(args: string[], client: PremanClient): Promise<void> {
  const env = localEnvFor(args);
  const request = omitUndefined({
    name: requiredValue(args, "--name", "tunnel requires --name \"Local MCP\""),
    slug: valueFor(args, "--slug"),
    command: requiredValue(args, "--command", "tunnel requires --command node"),
    args: valuesFor(args, "--arg"),
    cwd: valueFor(args, "--cwd"),
    envNames: Object.keys(env),
    accessMode: accessModeFor(args),
    scopes: scopesForTunnel(args),
    request: { idempotencyKey: valueFor(args, "--idempotency-key") },
  });

  if (hasFlag(args, "--register-only")) {
    console.log(JSON.stringify(await client.createLocalStdioTunnel(request), null, 2));
    return;
  }

  const tunnel = await runLocalStdioTunnel(client, {
    ...request,
    env,
    pollWaitMs: numberFor(args, "--poll-wait-ms"),
    onEvent: (event) => {
      if (event.type === "registered") {
        console.error(`PreMan local STDIO tunnel registered: ${event.tunnel.tunnelId}`);
        if (event.tunnel.hostedUrl) console.error(`Hosted MCP URL: ${event.tunnel.hostedUrl}`);
        if (event.tunnel.dashboardUrl) console.error(`Dashboard: ${event.tunnel.dashboardUrl}`);
        return;
      }
      if (event.type === "started") {
        console.error(`Local STDIO MCP started${event.pid ? ` (pid ${event.pid})` : ""}.`);
        return;
      }
      if (event.type === "stderr") {
        console.error(event.line);
        return;
      }
      if (event.type === "closed") {
        console.error(`Local STDIO MCP closed with code ${event.code ?? "unknown"}${event.signal ? ` (${event.signal})` : ""}.`);
      }
    },
  });
  console.log(JSON.stringify(tunnel, null, 2));
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function valuesFor(args: string[], flag: string): string[] | undefined {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1] as string);
  }
  return values.length ? values : undefined;
}

function requiredValue(args: string[], flag: string, message: string): string {
  const value = valueFor(args, flag);
  if (!value) throw new Error(message);
  return value;
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

function scopesFor(args: string[], command: string): string[] {
  const scopes = valueFor(args, "--scopes")?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!scopes?.length) throw new Error(`${command} requires --scopes read:users,write:orders`);
  return scopes;
}

function scopesForTunnel(args: string[]): string[] | undefined {
  const fromCsv = valueFor(args, "--scopes")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const repeated = valuesFor(args, "--scope") ?? [];
  const scopes = [...fromCsv, ...repeated].filter(Boolean);
  return scopes.length ? scopes : undefined;
}

function localEnvFor(args: string[]): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const entry of valuesFor(args, "--env") ?? []) {
    const equals = entry.indexOf("=");
    if (equals === -1) {
      env[entry] = process.env[entry];
      continue;
    }
    const name = entry.slice(0, equals);
    if (!name) throw new Error("--env entries must be NAME or NAME=value");
    env[name] = entry.slice(equals + 1);
  }
  return env;
}

async function endpointsFromRequiredFile(args: string[], command: string): Promise<EndpointDefinition[]> {
  const file = valueFor(args, "--file");
  if (!file) throw new Error(`${command} requires --file endpoints.json`);
  return JSON.parse(await readFile(file, "utf8")) as EndpointDefinition[];
}

async function upstreamSecretFor(args: string[]): Promise<string | undefined> {
  const inline = valueFor(args, "--upstream-secret");
  if (inline) return inline;
  const envName = valueFor(args, "--upstream-secret-env");
  return resolveSecret(envName ? secretFromEnv(envName) : undefined);
}

function upstreamSecretTypeFor(args: string[]): "bearer" | "api_key" | "basic" | "custom" | undefined {
  const value = valueFor(args, "--upstream-secret-type");
  if (!value) return undefined;
  if (["bearer", "api_key", "basic", "custom"].includes(value)) {
    return value as "bearer" | "api_key" | "basic" | "custom";
  }
  throw new Error("--upstream-secret-type must be bearer, api_key, basic, or custom");
}

function accessModeFor(args: string[]): "public" | "token" | undefined {
  const value = valueFor(args, "--access-mode");
  if (!value) return undefined;
  if (value === "public" || value === "token") return value;
  throw new Error("--access-mode must be public or token");
}

function upstreamAuthStyleFor(args: string[]): { type?: "header" | "query" | "basic"; name?: string; prefix?: string } | undefined {
  const type = valueFor(args, "--auth-type") as "header" | "query" | "basic" | undefined;
  const name = valueFor(args, "--auth-name") ?? valueFor(args, "--auth-header");
  const prefix = valueFor(args, "--auth-prefix");
  if (type && !["header", "query", "basic"].includes(type)) {
    throw new Error("--auth-type must be header, query, or basic");
  }
  const style = omitUndefined({ type, name, prefix });
  return Object.keys(style).length ? style : undefined;
}

function printHelp(): void {
  console.log(`PreMan SDK CLI

Usage:
  npx preman-sdk init --api-key pm_live_...
  npx preman-sdk register --file endpoints.json --upstream https://api.example.com --intent "Auth endpoints"
  npx preman-sdk deploy --name "Auth MCP" --file endpoints.json --upstream https://api.example.com
  npx preman-sdk import-docs --url https://docs.example.com/api --name "Public API MCP"
  npx preman-sdk import-remote-mcp --url https://remote-mcp.example.com/mcp --name "Remote MCP Proxy"
  npx preman-sdk tunnel --name "Local Files MCP" --command npx --arg -y --arg @modelcontextprotocol/server-filesystem --arg .
  npx preman-sdk hosted-mcps
  npx preman-sdk hosted-mcps --id mcp_123
  npx preman-sdk token --mcp-id mcp_123 --consumer-label cursor-agent --scopes auth:login --rate-limit-rpm 60
  npx preman-sdk token list --mcp-id mcp_123
  npx preman-sdk token revoke --mcp-id mcp_123 --token-id token_123
  npx preman-sdk token rotate --mcp-id mcp_123 --token-id token_123 --scopes auth:login
  npx preman-sdk import openapi --file openapi.json --out endpoints.json
  npx preman-sdk import postman --file collection.json --deploy --upstream https://api.example.com
  npx preman-sdk apply --file preman.config.json --dry-run
  npx preman-sdk snapshot --mcp-id mcp_123 --out preman-catalog.snapshot.json
  npx preman-sdk diff --approved preman-catalog.snapshot.json --mcp-id mcp_123
  npx preman-sdk typegen --file endpoints.json --out preman-endpoints.ts
  npx preman-sdk typegen --mcp-id mcp_123 --client --out preman-tools.ts
  npx preman-sdk install-snippet --target cursor --server-name auth-mcp --url https://api.preman.live/h/.../mcp --token-env PREMAN_CONSUMER_TOKEN --write
  npx preman-sdk status

Global install:
  npm install -g preman-sdk
  preman status

Options:
  --api-url                 Override API URL (default: https://api.preman.live)
  --app-url                 Override app URL (default: https://app.preman.live)
  --upstream                Your real API base URL. Example: https://api.company.com
  --allow-local             Allow localhost/private upstreams for local-only previews
  --session-id              Reuse a PreMan playground session id
  --upstream-secret         Upstream API secret stored with a hosted MCP deploy
  --upstream-secret-env     Read upstream API secret from an environment variable
  --upstream-secret-type    bearer, api_key, basic, or custom
  --auth-type               How to attach the upstream secret: header, query, or basic
  --auth-name               Header/query name for upstream auth (default: Authorization)
  --auth-prefix             Prefix for the secret (default server behavior: Bearer )
  --access-mode             public or token
  --arg                     Repeat for each local STDIO MCP command argument used by tunnel
  --env                     Repeat NAME or NAME=value for local STDIO MCP env vars; values stay local
  --scope                   Repeat to attach an allowed tool scope to a local STDIO tunnel
  --register-only           Register a local STDIO tunnel without starting the local process
  --poll-wait-ms            Long-poll wait time for local STDIO tunnel messages
  --max-endpoints           Max docs endpoints to import (default server behavior: 80)
  --preview                 For import-docs, discover and return generated spec without deploying
  --approved                Approved catalog snapshot for diff
  --allow-removed-tools     Do not fail diff on removed tools
  --allow-renamed-tools     Do not fail diff on likely renamed tools
  --allow-schema-broadening Do not fail diff on broader input schemas
  --allow-new-write-tools   Do not fail diff on new POST/PUT/PATCH/DELETE tools
  --client                  For typegen --mcp-id, emit a thin callTool wrapper
  --consumer-label          Initial consumer token label (default: default-consumer)
  --idempotency-key         Idempotency key for write operations
  --version                 Print CLI version

Auth:
  The CLI uses your PreMan workspace API key, currently formatted as pm_live_...
  Create one at https://app.preman.live/settings.
  You can save it with init or set PREMAN_API_KEY.

Upstream:
  PreMan combines --upstream with each endpoint path.
  Example: --upstream https://api.company.com + /auth/login = https://api.company.com/auth/login
  Do not use a marketing site unless that site is also your API.
  localhost only works for local testing; hosted MCPs need a deployed or tunneled API URL.

The CLI is the on-ramp. Use the hosted workspace at https://app.preman.live
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
