# PreMan SDK

Language for PreMan's hosted MCP gateway product as exposed through this SDK and the workspace at app.preman.live.

## Hosted runtime

**Hosted MCP**:
A PreMan-managed MCP gateway with a stable `hostedUrl` that agents connect to. PreMan applies auth, policy, and audit before forwarding tool calls.
_Avoid_: MCP server (ambiguous — may mean upstream), gateway (use only when emphasizing proxy role)

**Hosted workspace**:
The operator control plane at app.preman.live where a team manages Hosted MCPs, consumer tokens, audit logs, and workspace-wide knowledge graph.
_Avoid_: App (conflicts with app.preman.live URL shorthand), dashboard (too generic)

**Hosted MCP overview**:
The workspace detail page for a single Hosted MCP, including activity metrics and MCP-facing documentation.
_Avoid_: MCP page, detail view

**Upstream**:
The HTTP API or remote MCP server that implements tool logic behind a Hosted MCP.
_Avoid_: Backend (too vague), API (may mean PreMan API)

**External upstream**:
An upstream the operator hosts; the operator supplies `upstreamBaseUrl`.
_Avoid_: Self-hosted API

**PreMan-hosted upstream**:
An upstream container PreMan builds and runs when `upstreamMode` is `preman`.
_Avoid_: App, hosted app

## Identity and access

**Workspace**:
A team's isolated PreMan account boundary. API keys (`pm_live_…`) are workspace-scoped.
_Avoid_: Account (ambiguous with end-user login), org

**Consumer token**:
A scoped credential (`pm_hmcp_…`) authorizing an agent or customer to call tools on one Hosted MCP.
_Avoid_: API key (reserved for workspace keys), session token

**Playground session**:
A pre-deploy workspace session for trying endpoints before creating a Hosted MCP.
_Avoid_: Agent session (implementation term), try session

## Creation paths

**Deploy**:
Create a Hosted MCP from endpoint definitions and an upstream URL or PreMan-hosted build.
_Avoid_: Publish, release

**Docs import**:
Create a Hosted MCP by discovering endpoints from a public `docsUrl` (OpenAPI, doc sites).
_Avoid_: OpenAPI import (mechanism, not outcome)

**Remote MCP import**:
Create a Hosted MCP that proxies an existing remote MCP URL; PreMan stores the approved tool catalog.
_Avoid_: MCP proxy (jargon), wrap

**Local STDIO tunnel**:
A Hosted MCP record whose runtime forwards JSON-RPC to a local STDIO MCP process via a connector.
_Avoid_: Tunnel MCP

## Apps

**App**:
A governed bundle of MCP members plus guideline pack and setup playbook, exposed at `POST /m/{slug}/mcp`. SDK methods: `discoverCapabilities`, `createApp`, `addAppMember`, `mintAppToken`. Agent guide: `preman-sdk/apps` (`AGENT_APPS_GUIDE`).
_Avoid_: Connector, profile (in user-facing copy)

**App template**:
Curated starter (`hike_planner_v1`, `concerts_finder_v1`, `ecommerce_v1`) that seeds default llms.txt and playbook.
_Avoid_: Hosted MCP template

## Documentation

**MCP llms.txt**:
Markdown documentation describing one Hosted MCP for AI agents: purpose, usage constraints, and pointers to deeper material. Follows the llms.txt spec where practical, but lives as PreMan-stored metadata rather than on the upstream site's `/llms.txt`.
_Avoid_: llms.txt (bare — ambiguous with website root files), README

**MCP llms.txt status**:
Whether documentation is `provided` (operator-authored), `enriched` (fetched from upstream), `generated` (platform auto-gen), or `incomplete`.
_Avoid_: Doc state, llms state

## What is not an "App"

**App** is a first-class domain term for governed MCP bundles (see PreMan-Backend `CONTEXT.md`). Use **Hosted MCP** for single-API gateways. The hostname app.preman.live refers to the **Hosted workspace**, not an App entity.
_Avoid_: Using "app" interchangeably with Hosted MCP or the workspace URL

## Implementation notes

Upstream-hosting agent guidance and API field mapping live in [docs/agent/upstream-hosting.md](docs/agent/upstream-hosting.md).

MCP llms.txt policy is recorded in [docs/adr/0001-llms-txt-for-hosted-mcps.md](docs/adr/0001-llms-txt-for-hosted-mcps.md).
