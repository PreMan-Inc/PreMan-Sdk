import type { DiscoveredCapability } from "./types.js";

/** Stable feature id agents can search for in SDK docs. */
export const PREMAN_APPS_FEATURE_ID = "preman_apps" as const;

/** Public capability search route (GET). */
export const PREMAN_CAPABILITIES_SEARCH_PATH = "/capabilities/search" as const;

/**
 * Agent-oriented guide for creating and using PreMan Apps.
 * Import when onboarding builder agents or generating deploy plans.
 */
export const AGENT_APPS_GUIDE = `PreMan Apps bundle multiple MCP members behind one governed runtime for a task
(e.g. find concerts, plan a hike, run eCommerce ops).

Two surfaces:
1. Platform API (pm_live_… key) — create Apps, import members, mint Consumer tokens
2. App runtime (pm_hmcp_… token) — invoke prefixed member tools at POST {api}/m/{slug}/mcp

Builder flow (SDK or preman-mcp call-tool):
  const matches = await client.discoverCapabilities({ query: "find concerts" });
  const created = await client.createApp({ name: "My Concerts", templateKey: "concerts_finder_v1" });
  // Optional: import MCP servers and attach members
  const imported = await client.importMcpServer({ mcpUrl: "https://..." });
  await client.addAppMember({
    profileId: created.profile.id,
    serverId: imported.server.id,
    prefix: "concerts",
  });
  const install = await client.mintAppToken({ profileId: created.profile.id });

Consumer flow (separate MCP install — platform key cannot call member tools):
  1. Install installSnippet from mintAppToken
  2. Call get_setup_status
  3. Read llms.txt at GET {api}/m/{slug}/llms.txt
  4. Invoke prefixed tools (e.g. weather_get_forecast, concerts_search_nearby)

Templates: hike_planner_v1, concerts_finder_v1, ecommerce_v1
Platform MCP tools (same API): preman_discover_capabilities, preman_create_app,
  preman_import_mcp_server, preman_add_app_member, preman_mint_app_token, preman_list_apps
`;

export function appRuntimeUrl(apiUrl: string, slug: string): string {
  return `${stripTrailingSlash(apiUrl)}/m/${encodeURIComponent(slug)}/mcp`;
}

export function appLlmsTxtUrl(apiUrl: string, slug: string): string {
  return `${stripTrailingSlash(apiUrl)}/m/${encodeURIComponent(slug)}/llms.txt`;
}

export function appDashboardUrl(appUrl: string, profileId: string): string {
  return `${stripTrailingSlash(appUrl)}/apps/${encodeURIComponent(profileId)}`;
}

export function normalizeDiscoveredCapability(raw: Record<string, unknown>): DiscoveredCapability {
  const capability = (raw["_capability"] && typeof raw["_capability"] === "object"
    ? raw["_capability"]
    : raw) as Record<string, unknown>;
  const kind = capability["kind"];
  return {
    kind: kind === "app" || kind === "template" || kind === "hosted_mcp" ? kind : "app",
    id: stringOrUndefined(capability, "id"),
    slug: nullableString(capability, "slug"),
    name: stringAt(capability, "name") || stringAt(raw, "name") || "Unknown",
    summarySnippet: stringOrUndefined(capability, "summary_snippet") ?? stringOrUndefined(capability, "summarySnippet"),
    llmsTxtUrl: nullableString(capability, "llms_txt_url") ?? nullableString(capability, "llmsTxtUrl"),
    runtimeUrl: nullableString(capability, "runtime_url") ?? nullableString(capability, "runtimeUrl"),
    installHint: stringOrUndefined(capability, "install_hint") ?? stringOrUndefined(capability, "installHint"),
    templateKey: nullableString(capability, "template_key") ?? nullableString(capability, "templateKey"),
    accessMode: nullableString(capability, "access_mode") ?? nullableString(capability, "accessMode"),
  };
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function stringAt(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  return typeof item === "string" ? item : "";
}

function stringOrUndefined(value: Record<string, unknown>, key: string): string | undefined {
  const item = value[key];
  return typeof item === "string" ? item : undefined;
}

function nullableString(value: Record<string, unknown>, key: string): string | null | undefined {
  const item = value[key];
  if (item === null) return null;
  return typeof item === "string" ? item : undefined;
}
