# PreMan Apps — agent SDK guide

Apps bundle MCP members for a task (find concerts, plan a hike, run eCommerce). See the backend feature context at `docs/agent/apps-feature.md` for product semantics.

## SDK surface

```ts
import { PremanClient, AGENT_APPS_GUIDE } from "preman-sdk";
import { appRuntimeUrl, appLlmsTxtUrl } from "preman-sdk/apps";

const client = new PremanClient({ apiKey: process.env.PREMAN_API_KEY });

// Discover by intent
const { matches } = await client.discoverCapabilities({ query: "find concerts near me" });

// Create from template
const created = await client.createApp({
  name: "My Concerts Finder",
  templateKey: "concerts_finder_v1",
});

// Attach an imported MCP member
const imported = await client.importMcpServer({ mcpUrl: "https://example.com/mcp" });
await client.addAppMember({
  profileId: created.profile.id,
  serverId: imported.server.id,
  prefix: "concerts",
});

// Mint Consumer install snippet
const install = await client.mintAppToken({ profileId: created.profile.id });
```

## CLI

```bash
preman discover --query "plan a hike"
preman apps templates
preman apps create --name "Sierra Hikes" --template-key hike_planner_v1
preman apps --slug sierra-hikes
```

## PreMan MCP (IDE)

The npm `preman-mcp` package exposes the same lifecycle via `POST /mcp/call-tool`:

- `preman_discover_capabilities`
- `preman_create_app`
- `preman_import_mcp_server`
- `preman_add_app_member`
- `preman_mint_app_token`
- `preman_list_apps`

Platform skill: `https://api.preman.live/skill.md`

## Templates

| Key | Task |
|-----|------|
| `hike_planner_v1` | Plan a hike |
| `concerts_finder_v1` | Find concerts |
| `ecommerce_v1` | Store + ads |
