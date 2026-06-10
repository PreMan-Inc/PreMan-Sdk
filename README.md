# PreMan SDK

[![GitHub stars](https://img.shields.io/github/stars/PreMan-Inc/PreMan-Sdk?style=social)](https://github.com/PreMan-Inc/PreMan-Sdk)
[![Website](https://img.shields.io/badge/PreMan-preman.live-black)](https://preman.live)
[![Workspace](https://img.shields.io/badge/PreMan-workspace-10b981)](https://app.preman.live)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

PreMan turns REST API endpoints into hosted MCP servers that AI agents can call with scoped consumer tokens.

Use this SDK when you want to register endpoints from code or CI, import API docs or existing remote MCP servers, deploy them behind a PreMan gateway URL, and mint scoped tokens for agents, customers, or temporary sessions. The hosted workspace at [app.preman.live](https://app.preman.live) is where your team sees hosted MCPs, customer tokens, audit logs, and the company knowledge graph generated from agent activity.

```text
Your API / CI job
  -> preman-sdk
  -> hosted MCP URL
  -> scoped token for an agent or customer
  -> audit logs in the hosted workspace
```

## Install

```bash
npm install preman-sdk
```

Or run the CLI directly:

```bash
npx preman-sdk init --api-key pm_live_your_key
```

The CLI uses your PreMan workspace API key. Create or copy one from [PreMan Settings](https://app.preman.live/settings). The key currently starts with `pm_live_`.

You can also skip `init` and set an environment variable:

```bash
export PREMAN_API_KEY=pm_live_your_key
```

## Quick Start

Create `endpoints.json`:

```json
[
  {
    "method": "POST",
    "path": "/auth/login",
    "description": "Login with email and password.",
    "scope": "auth:login",
    "requestBodySchema": {
      "type": "object",
      "properties": {
        "email": { "type": "string", "format": "email" },
        "password": { "type": "string" }
      },
      "required": ["email", "password"]
    }
  }
]
```

Register the endpoints into a PreMan playground session:

```bash
npx preman-sdk register --file endpoints.json --upstream https://api.company.com
```

`--upstream` is the base URL of the API PreMan should call. It is not your marketing site and it is not the hosted PreMan workspace URL.

For example, if your endpoint file contains `POST /auth/login` and you pass:

```bash
--upstream https://api.company.com
```

PreMan tests and hosts the tool against:

```text
https://api.company.com/auth/login
```

Use a deployed or tunneled API URL for hosted MCPs. `http://localhost:8000` only works from your own machine; PreMan's hosted runtime cannot reach your laptop unless you expose it with a tunnel such as ngrok or Cloudflare Tunnel.

The CLI blocks `localhost` and private-network upstreams during `deploy` by default so you do not create a hosted MCP that cannot reach your API. Use `--allow-local` only for local-only previews.

Deploy the same endpoints as a hosted MCP:

```bash
npx preman-sdk deploy \
  --name "Company Auth MCP" \
  --file endpoints.json \
  --upstream https://api.company.com
```

Mint a scoped consumer token:

```bash
npx preman-sdk token \
  --mcp-id 093c4ad4-477a-4e47-94b5-24ea8f1fe4f4 \
  --consumer-label "Acme support agent" \
  --scopes auth:login \
  --rate-limit-rpm 60
```

Then open [app.preman.live](https://app.preman.live) to inspect the hosted MCP, copy the install snippet, revoke tokens, and review audit logs.

## MCP Gateway Imports

PreMan can sit in front of APIs you discover from docs or MCP servers you already run. Agents install one PreMan URL; PreMan stores the approved tool catalog, applies auth and policy, and logs every call.

Create a hosted MCP from public API docs:

```bash
npx preman-sdk import-docs \
  --url https://docs.company.com/api-reference \
  --name "Company API MCP" \
  --upstream https://api.company.com \
  --max-endpoints 120
```

Preview discovery without deploying:

```bash
npx preman-sdk import-docs \
  --url https://docs.company.com/api-reference \
  --preview
```

Put an existing remote MCP server behind a PreMan gateway:

```bash
npx preman-sdk import-remote-mcp \
  --url https://mcp.company.com/mcp \
  --name "Company MCP Proxy" \
  --upstream-secret-env COMPANY_MCP_TOKEN \
  --auth-type header \
  --auth-name Authorization \
  --auth-prefix "Bearer "
```

Register and run a local STDIO MCP through a PreMan tunnel:

```bash
npx preman-sdk tunnel \
  --name "Local Files MCP" \
  --command npx \
  --arg -y \
  --arg @modelcontextprotocol/server-filesystem \
  --arg . \
  --scope files:read \
  --env FILESYSTEM_ROOT
```

`tunnel` sends command metadata and env var names to PreMan, but env values stay
on your machine. The local connector process forwards JSON-RPC messages between
the hosted PreMan gateway and the STDIO MCP process so hosted audit logs,
consumer-token scoping, and policy checks can stay in the PreMan runtime. Use
`--register-only` when you only want to create the hosted tunnel record without
starting the local process.

List the hosted MCPs in your workspace:

```bash
npx preman-sdk hosted-mcps
npx preman-sdk hosted-mcps --id mcp_123
```

## TypeScript SDK

```ts
import { PremanClient } from "preman-sdk";

const preman = new PremanClient({
  apiKey: process.env.PREMAN_API_KEY,
  apiUrl: "https://api.preman.live",
  appUrl: "https://app.preman.live",
});

const endpoints = [
  {
    method: "POST" as const,
    path: "/auth/login",
    scope: "auth:login",
    description: "Login with email and password.",
    requestBodySchema: {
      type: "object",
      properties: {
        email: { type: "string", format: "email" },
        password: { type: "string" },
      },
      required: ["email", "password"],
    },
  },
];

const session = await preman.registerEndpoints({
  upstreamBaseUrl: "https://api.company.com",
  intent: "Auth endpoints",
  endpoints,
});

console.log(session.dashboardUrl);

const mcp = await preman.deployMcp({
  sessionId: session.sessionId,
  name: "Auth MCP",
  upstreamBaseUrl: "https://api.company.com",
  endpoints,
});

console.log(mcp.hostedUrl);
console.log(mcp.installSnippet?.mcpJsonString);
```

Import docs or a remote MCP directly from TypeScript:

```ts
const docsMcp = await preman.importFromDocs({
  docsUrl: "https://docs.company.com/api-reference",
  name: "Company API MCP",
  upstreamBaseUrl: "https://api.company.com",
  maxEndpoints: 120,
});

const remoteMcp = await preman.importRemoteMcp({
  mcpUrl: "https://mcp.company.com/mcp",
  name: "Company MCP Proxy",
  initialUpstreamSecret: process.env.COMPANY_MCP_TOKEN,
  upstreamAuthStyle: { type: "header", name: "Authorization", prefix: "Bearer " },
});

console.log(docsMcp.hostedUrl);
console.log(remoteMcp.installSnippet?.mcpJsonString);
```

Start a local STDIO tunnel from TypeScript:

```ts
import { PremanClient, runLocalStdioTunnel } from "preman-sdk";

const preman = new PremanClient({ apiKey: process.env.PREMAN_API_KEY });

await runLocalStdioTunnel(preman, {
  name: "Local Files MCP",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
  envNames: ["FILESYSTEM_ROOT"],
  env: { FILESYSTEM_ROOT: process.env.FILESYSTEM_ROOT },
  scopes: ["files:read"],
});
```

## Token Scoping

PreMan consumer tokens are scoped to a hosted MCP. The hosted MCP runtime verifies the token before forwarding a tool call to your upstream API.

A token can include:

- a hosted MCP id
- a consumer label, such as a customer or agent session
- one or more scopes, such as `auth:login` or `orders:write`
- optional rate limits
- an upstream credential binding

Calls outside the token's scope are denied by the hosted runtime and appear in the hosted workspace audit trail. Tokens can be listed, rotated, and revoked from the SDK, CLI, or hosted workspace.

```bash
preman token list --mcp-id mcp_123
preman token revoke --mcp-id mcp_123 --token-id token_123
preman token rotate --mcp-id mcp_123 --token-id token_123 --scopes auth:login --consumer-label cursor-agent
```

## Import Existing API Docs

Generate endpoint manifests from OpenAPI or Postman, then register or deploy them.

```bash
preman import openapi --file openapi.json --out endpoints.json
preman import postman --file collection.json --register --upstream https://api.company.com
preman import openapi --file openapi.json --deploy --name "Public API MCP" --upstream https://api.company.com
```

## Policy Manifests

For CI and repeatable deploys, put the upstream, endpoints, and scopes in a manifest:

```json
{
  "name": "Auth MCP",
  "upstream": "https://api.company.com",
  "intent": "Auth endpoints",
  "endpoints": [
    { "method": "POST", "path": "/auth/login", "scope": "auth:login" }
  ],
  "policies": [
    { "scope": "auth:login", "rateLimitRpm": 60, "ttlSeconds": 900 }
  ],
  "deploy": {
    "name": "Auth MCP",
    "initialConsumerLabel": "default-consumer"
  }
}
```

Preview before writing anything:

```bash
preman apply --file preman.config.json --dry-run
preman apply --file preman.config.json --deploy
```

## Generated Types

Create TypeScript request/response types from your endpoint manifest:

```bash
preman typegen --file endpoints.json --out preman-endpoints.ts
```

Create typed wrappers from the actual hosted MCP catalog agents will call:

```bash
preman typegen --mcp-id mcp_123 --client --out preman-tools.ts
```

The hosted catalog typegen reads the stored `tools/list` schema, including nested
objects, arrays, enums, nullable fields, `anyOf` / `oneOf`, and
`additionalProperties`. Use `--client` when you want a thin typed wrapper around
your own `callTool(name, args)` implementation for tests or internal automations.

## Catalog Snapshots And CI Drift Checks

Pin the approved hosted MCP catalog to disk:

```bash
preman snapshot --mcp-id mcp_123 --out preman-catalog.snapshot.json
```

Then fail CI if production drifts from the approved catalog:

```bash
preman diff --approved preman-catalog.snapshot.json --mcp-id mcp_123
```

`diff` exits non-zero for removed tools, likely renames, broader input schemas,
or new write-capable tools (`POST`, `PUT`, `PATCH`, `DELETE`) unless you pass the
matching approval flag:

```bash
preman diff \
  --approved preman-catalog.snapshot.json \
  --mcp-id mcp_123 \
  --allow-new-write-tools
```

GitHub Actions example:

```yaml
name: MCP catalog drift
on:
  pull_request:
  push:
    branches: [main]
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install -g preman-sdk
      - run: preman diff --approved preman-catalog.snapshot.json --mcp-id ${{ vars.PREMAN_MCP_ID }}
        env:
          PREMAN_API_KEY: ${{ secrets.PREMAN_API_KEY }}
```

## Install Snippets

After minting a hosted MCP consumer token, generate or write client config:

```bash
preman install-snippet \
  --target cursor \
  --server-name auth-mcp \
  --url https://api.preman.live/h/mcp_123/mcp \
  --token-env PREMAN_CONSUMER_TOKEN

preman install-snippet \
  --target cursor \
  --server-name auth-mcp \
  --url https://api.preman.live/h/mcp_123/mcp \
  --token-env PREMAN_CONSUMER_TOKEN \
  --write
```

The SDK also exports `hostedMcpJson()`, `installCommand()`, and `writeMcpInstall()` for product flows that need to generate Cursor, Claude, or VS Code instructions.

## Reliability And Observability

`PremanClient` supports request timeouts, retries, idempotency keys, and hooks for logging.

```ts
const preman = new PremanClient({
  apiKey: process.env.PREMAN_API_KEY,
  timeoutMs: 15_000,
  retry: { retries: 2, initialDelayMs: 250 },
  hooks: {
    onRequest: (event) => console.log("preman request", event.requestId, event.path),
    onResponse: (event) => console.log("preman response", event.status, event.durationMs),
    onError: (event) => console.error("preman error", event.status, event.error),
  },
});

await preman.deployMcp({
  name: "Auth MCP",
  upstreamBaseUrl: "https://api.company.com",
  endpoints,
  request: { idempotencyKey: crypto.randomUUID() },
});
```

For write operations that may be retried, pass an idempotency key. The client includes `X-Request-Id` on every request so API logs, CI logs, and hosted audit events can be correlated.

## Secret Handling

Avoid putting upstream or consumer secrets in shell history. Use environment-backed secret providers:

```bash
export API_BEARER_TOKEN=prod_token
preman deploy \
  --name "Auth MCP" \
  --file endpoints.json \
  --upstream https://api.company.com \
  --upstream-secret-env API_BEARER_TOKEN \
  --upstream-secret-type bearer
```

Programmatic helpers:

```ts
import { resolveSecret, secretFromEnv } from "preman-sdk";

const upstreamSecret = await resolveSecret(secretFromEnv("API_BEARER_TOKEN"));
```

## GitHub Action

Use the bundled action to register endpoints from CI:

```yaml
name: Register endpoints
on: [push]
jobs:
  preman:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: PreMan-Inc/PreMan-Sdk@main
        with:
          api-key: ${{ secrets.PREMAN_API_KEY }}
          endpoint-file: endpoints.json
          upstream: https://api.company.com
```

## CLI Reference

```bash
npx preman-sdk init --api-key pm_live_...
npx preman-sdk status
npx preman-sdk register --file endpoints.json --upstream https://api.company.com
npx preman-sdk deploy --name "Auth MCP" --file endpoints.json --upstream https://api.company.com
npx preman-sdk tunnel --name "Local Files MCP" --command npx --arg -y --arg @modelcontextprotocol/server-filesystem --arg .
npx preman-sdk token --mcp-id mcp_123 --consumer-label cursor-agent --scopes auth:login --rate-limit-rpm 60
npx preman-sdk token list --mcp-id mcp_123
npx preman-sdk token revoke --mcp-id mcp_123 --token-id token_123
npx preman-sdk import openapi --file openapi.json --out endpoints.json
npx preman-sdk apply --file preman.config.json --dry-run
npx preman-sdk snapshot --mcp-id mcp_123 --out preman-catalog.snapshot.json
npx preman-sdk diff --approved preman-catalog.snapshot.json --mcp-id mcp_123
npx preman-sdk typegen --file endpoints.json --out preman-endpoints.ts
npx preman-sdk typegen --mcp-id mcp_123 --client --out preman-tools.ts
```

### What `--upstream` Means

`--upstream` is the base URL for your real backend API:

```text
--upstream + endpoint path = full URL PreMan calls
```

Examples:

```text
https://api.company.com + /auth/login = https://api.company.com/auth/login
https://staging.company.com/api + /orders = https://staging.company.com/api/orders
```

Do not use `https://preman.live` unless your actual API is hosted there. For local APIs, use a public tunnel before deploying a hosted MCP.

## Configuration

The CLI stores local config at:

```text
~/.preman/config.json
```

Environment variables override local config:

```bash
PREMAN_API_KEY=pm_live_your_key
PREMAN_API_URL=https://api.preman.live
PREMAN_APP_URL=https://app.preman.live
```

## Current API Surface

Working today:

- `registerEndpoints()` -> creates or updates a PreMan playground session
- `deployMcp()` -> creates a hosted MCP from endpoint definitions
- `createToken()` -> mints a scoped hosted MCP consumer token
- `listTokens()` / `revokeToken()` / `rotateToken()` -> manage hosted MCP token lifecycle
- `verifyToken()` / `verifyBearerToken()` -> verifies hosted MCP consumer tokens and scopes
- `audit()` -> writes custom non-MCP agent events into PreMan audit logs
- `fromOpenApi()` / `fromPostmanCollection()` -> converts API docs into endpoint definitions
- `previewManifest()` / `readManifest()` -> validate policy-as-code manifests and dry runs
- `generateEndpointTypes()` -> generate TypeScript types from endpoint schemas
- `generateHostedMcpToolTypes()` -> generate TypeScript types from hosted MCP tool catalogs
- `createCatalogSnapshot()` / `diffCatalogSnapshots()` -> pin approved tool catalogs and detect CI drift
- `hostedMcpJson()` / `writeMcpInstall()` -> generate or write MCP install snippets
- `resolveSecret()` / `secretFromEnv()` -> keep secrets out of command text and config
- framework examples for Express, Fastify, Next.js, and Hono in `examples/frameworks`
- `preman` CLI -> setup, register, import, apply, deploy, tokens, typegen, install snippets, status

Hosted MCP calls are already authenticated, scoped, and audited by PreMan.

## Development

```bash
npm install
npm test
npm run build
```

Live staging checks are opt-in so unit tests stay offline and fast:

```bash
PREMAN_API_KEY=pm_live_... npm run integration
```

Optional integration fixtures:

```bash
PREMAN_API_URL=https://api.preman.live
PREMAN_TEST_OPENAPI_URL=https://petstore3.swagger.io/api/v3/openapi.json
PREMAN_TEST_REMOTE_MCP_URL=https://mcp.example.com/mcp
```

## License

MIT
