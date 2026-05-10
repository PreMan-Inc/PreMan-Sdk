# PreMan SDK

[![GitHub stars](https://img.shields.io/github/stars/Watcher1223/PreMan-Sdk?style=social)](https://github.com/Watcher1223/PreMan-Sdk/stargazers)
[![Website](https://img.shields.io/badge/PreMan-preman.live-black)](https://preman.live)
[![Hosted workspace](https://img.shields.io/badge/OpenTest-workspace-10b981)](https://www.flowtest.opentest.live)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

PreMan turns existing API endpoints into secure, hosted MCP tools for AI agents.

The SDK is for teams that want to register endpoints, deploy MCP servers, issue scoped tokens, verify agent access, and write audit events from code or CI. The hosted OpenTest workspace is where your team sees the deployed MCPs, customer tokens, audit logs, and the company knowledge graph built from agent activity.

```text
Your API or CI job
  -> PreMan SDK
  -> Hosted OpenTest workspace
  -> MCP URL + scoped token for an agent or customer
```

## When To Use It

Use the SDK when you want to:

- register REST endpoints from a repo, OpenAPI export, or CI job
- deploy selected endpoints as a hosted MCP server
- mint short-lived tokens for agents, customers, or sessions
- enforce token scopes before an agent can call a tool
- send custom audit events into the hosted workspace
- automate setup without clicking through the UI

Use the hosted workspace at [flowtest.opentest.live](https://www.flowtest.opentest.live) to inspect deployed MCPs, manage customer tokens, revoke access, review audit logs, and see the company knowledge graph generated from agent activity.

## Install

```bash
npm install @preman/sdk
```

Or use the CLI from a project:

```bash
npx preman init --api-key pm_live_your_key
```

## Quick Start

Create an endpoint file:

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

Register the endpoint:

```bash
preman register --file endpoints.json --upstream https://api.company.com
```

Deploy it as a hosted MCP:

```bash
preman deploy \
  --name "Company Auth MCP" \
  --file endpoints.json \
  --upstream https://api.company.com
```

Mint a scoped token for one agent session:

```bash
preman token \
  --mcp-id mcp_123 \
  --agent-id cursor-agent \
  --scopes auth:login \
  --ttl 900
```

Then open [flowtest.opentest.live](https://www.flowtest.opentest.live) to see the MCP, token, call history, audit logs, and agent activity graph.

## How Token Scoping Works

PreMan tokens are intentionally narrow. A token can be tied to:

- an MCP server, such as `mcp_123`
- an agent identity, such as `cursor-agent`
- a customer identity, such as `customer_acme`
- one or more scopes, such as `auth:login` or `orders:write`
- a TTL, such as `900` seconds
- optional usage limits, such as max tool calls

When an agent calls a hosted MCP tool, PreMan checks the token before forwarding the request to your upstream API. Calls outside the token's scope are denied and written to the audit log. Expired or revoked tokens stop working immediately.

Your team can manage and revoke those tokens from the hosted workspace.

## TypeScript SDK

```ts
import { PremanClient } from "@preman/sdk";

const preman = new PremanClient({
  apiKey: process.env.PREMAN_API_KEY,
  apiUrl: "https://flow.opentest.live",
  appUrl: "https://www.flowtest.opentest.live",
});

const mcp = await preman.deployMcp({
  name: "Auth MCP",
  upstreamBaseUrl: "https://api.company.com",
  endpoints: [
    {
      method: "POST",
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
  ],
});

const token = await preman.createToken({
  mcpId: mcp.mcpId,
  agentId: "cursor-agent",
  scopes: ["auth:login"],
  ttlSeconds: 900,
});

console.log(mcp.hostedUrl);
console.log(token.installSnippet.mcpJsonString);
```

## Verify Agent Access

If your API receives PreMan-issued tokens directly, verify them before serving the request.

```ts
import { PremanClient, verifyBearerToken } from "@preman/sdk";

const preman = new PremanClient({
  apiKey: process.env.PREMAN_API_KEY,
});

export async function POST(request: Request) {
  const identity = await verifyBearerToken(request.headers, {
    client: preman,
    requiredScope: "orders:write",
  });

  return Response.json({
    ok: true,
    agentId: identity.agentId,
    customerId: identity.customerId,
  });
}
```

## Write Audit Events

Use audit events for actions that happen outside the hosted MCP runtime but still matter to agent observability.

```ts
await preman.audit({
  agentId: "cursor-agent",
  customerId: "customer_acme",
  action: "orders.exported",
  resource: "orders",
  outcome: "success",
  metadata: {
    rowCount: 42,
  },
});
```

Those events appear in the hosted workspace alongside MCP tool calls.

## CLI Reference

```bash
preman init --api-key pm_live_...
preman status
preman register --file endpoints.json --upstream https://api.company.com
preman deploy --name "Auth MCP" --file endpoints.json --upstream https://api.company.com
preman token --mcp-id mcp_123 --agent-id cursor-agent --scopes auth:login --ttl 900
```

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

## SDK vs Hosted Workspace

The SDK should stay thin and automatable:

- endpoint registration
- hosted MCP deployment helpers
- scoped token creation
- token verification helpers
- custom audit event logging
- CLI commands for local setup and CI

The hosted workspace is where teams operate the system:

- hosted MCP servers
- customer and agent tokens
- policy, revocation, and expiry
- audit logs and tool-call traces
- agent observability dashboards
- company knowledge graph from agent activity

## Development

```bash
npm install
npm run build
```

## License

MIT
