/**
 * Generate standard llms.txt markdown for a PreMan hosted MCP gateway.
 */

export type HostedMcpLlmsInput = {
  name: string;
  mcpId: string;
  apiUrl: string;
  appUrl?: string;
  upstreamBaseUrl?: string;
  tools?: Array<{ name?: string; description?: string }>;
  apifyActorId?: string;
};

const APIFY_PREFIX = "Apify: ";

export function stripApifyNamePrefix(name: string): string {
  return name.startsWith(APIFY_PREFIX) ? name.slice(APIFY_PREFIX.length) : name;
}

export function isApifyHostedMcp(record: {
  name?: string;
  upstream_base_url?: string;
}): boolean {
  if (typeof record.name === "string" && record.name.startsWith(APIFY_PREFIX)) {
    return true;
  }
  const upstream = record.upstream_base_url ?? "";
  return upstream.includes("mcp.apify.com");
}

export function hasApifyNamePrefix(name: string | undefined): boolean {
  return typeof name === "string" && name.startsWith(APIFY_PREFIX);
}

export function apifyActorIdFromUpstream(upstreamBaseUrl: string): string | undefined {
  try {
    const url = new URL(upstreamBaseUrl);
    if (!url.hostname.includes("mcp.apify.com")) return undefined;
    const tools = url.searchParams.get("tools");
    return tools?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function hostedMcpLlmsTxtUrl(apiUrl: string, mcpId: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/h/${encodeURIComponent(mcpId)}/llms.txt`;
}

export function hostedMcpGatewayUrl(apiUrl: string, mcpId: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/h/${encodeURIComponent(mcpId)}/mcp`;
}

export function generateHostedMcpLlmsTxt(input: HostedMcpLlmsInput): string {
  const name = stripApifyNamePrefix(input.name.trim());
  const gatewayUrl = hostedMcpGatewayUrl(input.apiUrl, input.mcpId);
  const llmsUrl = hostedMcpLlmsTxtUrl(input.apiUrl, input.mcpId);
  const dashboardUrl = input.appUrl
    ? `${input.appUrl.replace(/\/+$/, "")}/hosted-mcps/${encodeURIComponent(input.mcpId)}`
    : undefined;
  const actorId = input.apifyActorId ?? (input.upstreamBaseUrl
    ? apifyActorIdFromUpstream(input.upstreamBaseUrl)
    : undefined);

  const lines: string[] = [
    `# ${name}`,
    "",
    "> PreMan hosted MCP gateway — scoped tools, audit logs, and prompt-injection filtering.",
    "",
    "## What this MCP is",
    "",
  ];

  if (actorId) {
    lines.push(
      `This gateway exposes the Apify Actor \`${actorId}\` (${name}) through PreMan.`,
      "PreMan proxies agent calls to Apify's hosted MCP server with per-customer tokens and usage analytics.",
      "",
    );
  } else {
    lines.push(
      `This gateway exposes **${name}** as an MCP server your agents can call through PreMan.`,
      "PreMan scopes tools, filters risky upstream output, and records every invocation.",
      "",
    );
  }

  lines.push("## Tools", "");

  const tools = input.tools ?? [];
  if (tools.length === 0) {
    lines.push(
      "_Tools are discovered from the upstream MCP catalog after the first connection._",
      "",
      "Call `tools/list` on the gateway URL to see the current tool names and input schemas.",
      "",
    );
  } else {
    for (const tool of tools) {
      const toolName = tool.name?.trim();
      if (!toolName) continue;
      const description = tool.description?.trim();
      lines.push(
        description ? `- \`${toolName}\` — ${description}` : `- \`${toolName}\``,
      );
    }
    lines.push("");
  }

  lines.push(
    "## How to use",
    "",
    "1. Add the MCP gateway URL to your agent's `mcp.json` (or mint a scoped customer token from the PreMan dashboard).",
    "2. List tools with `tools/list`, then invoke a tool with `tools/call`.",
    "3. Monitor calls, errors, and latency from the PreMan dashboard overview.",
    "",
    "## Links",
    "",
    `- MCP gateway: ${gatewayUrl}`,
    `- llms.txt: ${llmsUrl}`,
  );

  if (dashboardUrl) {
    lines.push(`- PreMan dashboard: ${dashboardUrl}`);
  }
  if (actorId) {
    lines.push(`- Apify Store: https://apify.com/${actorId}`);
  }
  if (input.upstreamBaseUrl) {
    lines.push(`- Upstream: ${input.upstreamBaseUrl}`);
  }

  lines.push("");
  return lines.join("\n");
}
