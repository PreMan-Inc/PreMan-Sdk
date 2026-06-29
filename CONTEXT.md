# PreMan SDK — upstream hosting (agent notes)

Feature id: `preman_upstream_hosting`

## Discover before deploy

```ts
import { PremanClient } from "preman-sdk";
import {
  AGENT_UPSTREAM_HOSTING_GUIDE,
  PREMAN_UPSTREAM_HOSTING_FEATURE_ID,
  resolveUpstreamDeployPlan,
  supportsPremanUpstreamHosting,
} from "preman-sdk/upstream-hosting";

const client = new PremanClient();
const capabilities = await client.getCapabilities();

if (supportsPremanUpstreamHosting(capabilities)) {
  // PreMan can run the operator's upstream container
} else {
  // Operator must supply upstreamBaseUrl (tunnel, Fly, Railway, etc.)
}
```

Print `AGENT_UPSTREAM_HOSTING_GUIDE` when helping an operator deploy a hosted MCP.

## API contract (SDK → Backend)

| SDK | Backend |
|-----|---------|
| `upstreamMode: "external"` | `upstream_mode: "external"` + `upstream_base_url` |
| `upstreamMode: "preman"` | `upstream_mode: "preman"` + `upstream_build` |
| `getCapabilities()` | `GET /capabilities` |
| `getUpstreamHostingStatus()` | `GET /hosted-mcps/{id}/upstream-hosting` |

Until Backend implements these routes, `getCapabilities()` returns external-only and preman deploy will fail at the API.
