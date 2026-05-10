# PreMan SDK

[![GitHub stars](https://img.shields.io/github/stars/Watcher1223/PreMan-Sdk?style=social)](https://github.com/Watcher1223/PreMan-Sdk)
[![Website](https://img.shields.io/badge/PreMan-preman.live-black)](https://preman.live)
[![Workspace](https://img.shields.io/badge/OpenTest-workspace-10b981)](https://www.flowtest.opentest.live)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

PreMan turns REST API endpoints into hosted MCP servers that AI agents can call with scoped consumer tokens.

Use this SDK when you want to register endpoints from code or CI, deploy them as hosted MCP tools, and mint scoped tokens for agents, customers, or temporary sessions. The hosted workspace at [flowtest.opentest.live](https://www.flowtest.opentest.live) is where your team sees hosted MCPs, customer tokens, audit logs, and the company knowledge graph generated from agent activity.

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

Register the endpoints into a Flow playground session:

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

Then open [flowtest.opentest.live](https://www.flowtest.opentest.live) to inspect the hosted MCP, copy the install snippet, revoke tokens, and review audit logs.

## TypeScript SDK

```ts
import { PremanClient } from "preman-sdk";

const preman = new PremanClient({
  apiKey: process.env.PREMAN_API_KEY,
  apiUrl: "https://flow.opentest.live",
  appUrl: "https://www.flowtest.opentest.live",
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

## Token Scoping

PreMan consumer tokens are scoped to a hosted MCP. The hosted MCP runtime verifies the token before forwarding a tool call to your upstream API.

A token can include:

- a hosted MCP id
- a consumer label, such as a customer or agent session
- one or more scopes, such as `auth:login` or `orders:write`
- optional rate limits
- an upstream credential binding

Calls outside the token's scope are denied by the hosted runtime and appear in the hosted workspace audit trail. Tokens can be revoked from the hosted workspace.

## CLI Reference

```bash
npx preman-sdk init --api-key pm_live_...
npx preman-sdk status
npx preman-sdk register --file endpoints.json --upstream https://api.company.com
npx preman-sdk deploy --name "Auth MCP" --file endpoints.json --upstream https://api.company.com
npx preman-sdk token --mcp-id mcp_123 --consumer-label cursor-agent --scopes auth:login --rate-limit-rpm 60
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
PREMAN_API_URL=https://flow.opentest.live
PREMAN_APP_URL=https://www.flowtest.opentest.live
```

## Current API Surface

Working today:

- `registerEndpoints()` -> creates or updates a Flow playground session
- `deployMcp()` -> creates a hosted MCP from endpoint definitions
- `createToken()` -> mints a scoped hosted MCP consumer token
- `preman` CLI -> setup, register, deploy, token minting, status

Planned next:

- SDK-side token verification middleware for customer backends
- custom audit event ingestion for non-MCP agent actions
- OpenAPI/Postman import helpers
- framework examples for Express, Fastify, Next.js, and Hono

Hosted MCP calls are already authenticated, scoped, and audited by PreMan.

## Development

```bash
npm install
npm test
npm run build
```

## License

MIT
