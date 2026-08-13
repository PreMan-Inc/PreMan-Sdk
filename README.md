# PreMan SDK

[![GitHub stars](https://img.shields.io/github/stars/PreMan-Inc/PreMan-Sdk?style=social)](https://github.com/PreMan-Inc/PreMan-Sdk)
[![Website](https://img.shields.io/badge/PreMan-preman.live-black)](https://preman.live)
[![Workspace](https://img.shields.io/badge/PreMan-workspace-10b981)](https://app.preman.live)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

PreMan continuously tests API endpoints and turns production failures into validated code fixes and pull requests.

Use this SDK to register endpoints, schedule safe probes, define when failures should trigger repair, inspect incidents, and run PreMan's native self-healing workflow. Hosted MCP access controls and post-agent action verification remain available as secondary capabilities.

```text
Your API endpoints
  -> continuous probes and failure rules
  -> incident with a reproducible fix task
  -> native repair + validation
  -> fix branch and pull request
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
# PREMAN_API_KEY also works for compatibility with the PreMan MCP.
```

## Quick Start: Self-Healing Endpoints

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

Register the endpoints from code or CI:

```bash
npx preman-sdk register --file endpoints.json --upstream https://api.company.com
```

Once the endpoint is saved in your PreMan workspace, enable a one-minute health probe:

```bash
npx preman-sdk monitor \
  --endpoint-id <endpoint-id> \
  --interval-seconds 60 \
  --expected-status 200
```

Create a rule that starts native repair after three consecutive failures:

```bash
npx preman-sdk healing-rule \
  --endpoint-id <endpoint-id> \
  --after-failures 3
```

`healing-rule` enables `autofix` by default. When the rule fires and the workspace has an eligible connected repository, PreMan packages the failing request and observed response, maps it to the code, patches and validates the fix, pushes a branch, and opens a PR. It does not merge automatically.

Follow incidents and repairs from the CLI:

```bash
npx preman-sdk incidents
npx preman-sdk fixes --status open
npx preman-sdk heal --fix-task-id <fix-task-id> --wait
```

Or configure the same loop in TypeScript:

```ts
import { PremanClient } from "preman-sdk";

const preman = new PremanClient();
const endpointId = process.env.PREMAN_ENDPOINT_ID!;

await preman.configureEndpointProbe({
  endpointId,
  intervalSeconds: 60,
  expectedStatus: 200,
});

await preman.createHealingRule({
  targetId: endpointId,
  thresholdFailures: 3,
  autofixEnabled: true,
});
```

Probe credentials are encrypted at rest and only their header names are returned. Scheduled requests default to `read_only`; destructive or billing-sensitive endpoints require an explicit `unattendedPolicy`.

Open [app.preman.live](https://app.preman.live) to watch endpoint health, investigate incidents, and follow each repair through validation and PR creation.

### Endpoint health aggregates and dependencies

Use the project-scoped Pulse APIs for custom health views and evidence-backed
blast-radius analysis:

```ts
const health = await preman.listEndpointHealth({
  projectId: "project_123",
  window: "24h",
  statuses: ["failed", "error"],
  sort: "error_rate",
  limit: 50,
});

const metrics = await preman.getEndpointHealthMetrics({
  projectId: health.projectId,
  window: "24h",
  endpointKey: health.endpoints[0]?.endpointKey,
});

const dependencies = await preman.getEndpointDependencies({
  projectId: health.projectId,
});
```

Dependency edges mean `source` depends on `target`. They come from explicit
collection declarations or stored endpoint-edge evidence; PreMan does not infer
them from route names or shared trace IDs.

## Hosted MCP and Agent Security

PreMan can also expose registered APIs as hosted MCP servers with scoped consumer tokens, policy controls, and audit logs. This remains supported for teams that need to secure agent access, but it is no longer the SDK's primary workflow.

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

## State assertions and read-only probes

`preman assert` evaluates deterministic state checks against either a supplied
observation or one read from a staging/system-of-record API with a read-only HTTP
probe. This command does not call the PreMan API and does not require
`PREMAN_API_KEY`.

Create `preman.assert.json`:

```json
{
  "id": "refund-created-correctly",
  "probe": {
    "url": "https://staging.example.com/refunds?order_id=1049",
    "method": "GET",
    "headersFromEnv": {
      "Authorization": "STAGING_AUTHORIZATION"
    },
    "notFoundStatuses": [404],
    "timeoutMs": 5000
  },
  "assertions": [
    { "op": "exists", "pointer": "/refunds/0" },
    { "op": "equals", "pointer": "/refunds/0/amount", "expected": 82 },
    { "op": "equals", "pointer": "/refunds/0/status", "expected": "issued" },
    { "op": "no_duplicate", "pointer": "/refunds" },
    { "op": "latency_threshold", "maxMs": 1000 }
  ]
}
```

Run it:

```bash
export STAGING_AUTHORIZATION="Bearer staging-token"
npx preman-sdk assert --file preman.assert.json
```

The command prints structured JSON. A fully passing check exits 0; assertion
mismatches or verifier errors exit non-zero.

Assertion semantics are intentionally strict:

- `exists` checks structural presence, not truthiness. `null`, `false`, `0`, and `""` exist.
- `not_exists` passes only for structural absence.
- `equals` uses deep strict JSON equality. Object key order does not matter; array order does.
- `contains` supports string substring checks and array member checks with deep equality.
- `no_duplicate` expects an already-filtered array and passes when it has at most one item.
- `latency_threshold` compares the observation latency to `maxMs`.

Verdicts distinguish business-state mismatch from verifier failure:

- `passed` means the observed state satisfies the assertion.
- `failed` means trustworthy observed state contradicted the assertion.
- `error` means the verifier could not establish the assertion reliably.

For HTTP probes, 2xx responses produce an observation, 404 represents absence,
only when the probe explicitly includes `"notFoundStatuses": [404]`, and
401/403/404/429/other 4xx/5xx/timeout/network/malformed JSON responses are
verifier errors otherwise. Probes support only GET and HEAD, reject URL
username/password credentials, use environment-backed headers for target
credentials in file-based CLI configs, and do not serialize resolved secrets.
Endpoint evidence preserves query parameter names but redacts query values and
strips URL fragments.

File-based assertion configs reject literal `probe.headers` values to avoid
committing credentials accidentally. Use `headersFromEnv` for `preman assert
--file ...`. Programmatic TypeScript callers may still pass literal `headers`
to `runHttpAssertionCheck` when they construct the probe in code. HTTP probe
latency measures the time required to obtain a usable observation, including
response body consumption and parsing.

Programmatic use:

```ts
import { evaluateStateAssertions, runHttpAssertionCheck } from "preman-sdk/assertions";

const pure = evaluateStateAssertions(
  { found: true, value: { refunds: [{ amount: 82 }] }, latencyMs: 37 },
  [
    { op: "exists", pointer: "/refunds/0" },
    { op: "equals", pointer: "/refunds/0/amount", expected: 82 },
  ],
);

const probed = await runHttpAssertionCheck({
  probe: {
    url: "https://staging.example.com/refunds?order_id=1049",
    headersFromEnv: { Authorization: "STAGING_AUTHORIZATION" },
    notFoundStatuses: [404],
  },
  assertions: [{ op: "no_duplicate", pointer: "/refunds" }],
});
```

This is the SDK-side assertion/probe foundation. It does not define an action
test runner, action-contract schema, consistency-window polling, replay,
certification, or server-side verification event storage.

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

## Upstream hosting modes

PreMan hosted MCPs use two URLs:

- **hostedUrl** — MCP endpoint for agents (`/h/{id}/mcp`)
- **upstream** — HTTP API that implements your tool endpoints

### External upstream (default)

You host the API and pass `upstreamBaseUrl` (CLI `--upstream`). PreMan proxies tool calls there.

### PreMan-hosted upstream (`upstreamMode: "preman"`)

PreMan builds and runs your upstream container. Discover support first, then deploy without a tunnel:

```ts
import { PremanClient } from "preman-sdk";
import {
  resolveUpstreamDeployPlan,
  supportsPremanUpstreamHosting,
} from "preman-sdk/upstream-hosting";

const preman = new PremanClient();
const capabilities = await preman.getCapabilities();

if (supportsPremanUpstreamHosting(capabilities)) {
  const plan = resolveUpstreamDeployPlan({
    capabilities,
    preferPremanHosting: true,
    upstreamBuild: { dockerfile: "Dockerfile", healthPath: "/health" },
  });

  const deployed = await preman.deployMcp({
    name: "Spotify MCP",
    upstreamMode: plan.upstreamMode,
    upstreamBuild: plan.upstreamBuild,
    endpoints,
  });

  await preman.waitForUpstreamHosting({ mcpId: deployed.mcpId });
}
```

**Agent discovery:** import `AGENT_UPSTREAM_HOSTING_GUIDE` from `preman-sdk/upstream-hosting`, or run `npx preman-sdk capabilities`.

**CLI:**

```bash
npx preman-sdk capabilities
npx preman-sdk deploy --name "Spotify MCP" --file endpoints.json \
  --upstream-mode preman --dockerfile Dockerfile --wait-upstream
npx preman-sdk upstream-hosting --mcp-id mcp_123 --wait
```

`GET /capabilities` returns `upstream_hosting` when the API supports PreMan-hosted upstreams. Older APIs return only external mode (SDK falls back safely).
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
npx preman-sdk assert --file preman.assert.json
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

Self-healing endpoint workflow:

- `listEndpointHealth()` -> lists project-scoped endpoint health aggregates and observations
- `getEndpointHealthMetrics()` -> reads health totals, latency percentiles, and sparkline buckets
- `getEndpointDependencies()` -> reads evidence-backed directed dependencies for blast-radius analysis
- `configureEndpointProbe()` / `listEndpointProbes()` -> continuously exercise saved API endpoints
- `listEndpointProbeResults()` -> inspect status, latency, and failure details
- `createHealingRule()` -> trigger incidents and native autofix after consecutive failures or an error-rate threshold
- `listEndpointIncidents()` -> inspect fired and resolved endpoint incidents
- `listFixTasks()` / `getFixTask()` -> follow reproducible repair packages
- `startSelfHealing()` / `waitForSelfHealing()` -> run repair, validation, branch push, and PR creation
- `resolveFixTask()` -> close a completed repair task

Endpoint discovery and testing:

- `registerEndpoints()` -> creates or updates a playground session
- `fromOpenApi()` / `fromPostmanCollection()` -> converts API docs into endpoint definitions
- `generateEndpointTypes()` -> generates TypeScript types from endpoint schemas

Secondary hosted MCP and agent-security capabilities:

- `deployMcp()` -> creates a hosted MCP from endpoint definitions
- `createToken()` -> mints a scoped hosted MCP consumer token
- `listTokens()` / `revokeToken()` / `rotateToken()` -> manage hosted MCP token lifecycle
- `verifyToken()` / `verifyBearerToken()` -> verifies hosted MCP consumer tokens and scopes
- `audit()` -> writes custom non-MCP agent events into PreMan audit logs
- `previewManifest()` / `readManifest()` -> validate policy-as-code manifests and dry runs
- `generateHostedMcpToolTypes()` -> generate TypeScript types from hosted MCP tool catalogs
- `createCatalogSnapshot()` / `diffCatalogSnapshots()` -> pin approved tool catalogs and detect CI drift
- `hostedMcpJson()` / `writeMcpInstall()` -> generate or write MCP install snippets
- `resolveSecret()` / `secretFromEnv()` -> keep secrets out of command text and config
- framework examples for Express, Fastify, Next.js, and Hono in `examples/frameworks`
- `preman` CLI -> monitoring, healing, setup, register, import, deploy, tokens, and type generation

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

## Legal

Use of PreMan is governed by our [Terms of Service](https://preman.live/terms). We process account, workspace, and runtime data as described in our [Privacy Policy](https://preman.live/privacy).

## License

MIT
