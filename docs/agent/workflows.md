# PreMan agentic workflows — SDK guide

Platform-agnostic integration for LangChain, Vercel AI SDK, CrewAI, and custom agent loops.

## Install

```bash
npm install preman-sdk
```

## Skill install (IDE agents)

```text
set up https://api.preman.live/skill.md
```

## Programmatic tools

```ts
import { PremanClient } from "preman-sdk";
import {
  createPremanAgentTools,
  createPremanToolHandlerMap,
  toOpenAITools,
  toAnthropicTools,
  AGENT_WORKFLOWS_GUIDE,
} from "preman-sdk/platform-tools";

const client = new PremanClient({ apiKey: process.env.PREMAN_API_KEY });
const tools = createPremanAgentTools(client);
const handlers = createPremanToolHandlerMap(tools);

// Direct invoke
await handlers.preman_discover_capabilities({ query: "find concerts" });

// OpenAI-compatible hosts
const openaiTools = toOpenAITools(tools);
```

## Single call

```ts
await client.callPlatformTool({
  tool: "preman_create_app",
  arguments: { name: "Trail Planner", template_key: "hike_planner_v1" },
});
```

## CLI

```bash
preman call-tool --tool preman_discover_capabilities --args '{"query":"plan a hike"}'
```

See backend `docs/agent/workflows-feature.md` for product semantics.
