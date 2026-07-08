/**
 * Batch maintenance for Apify-hosted MCP gateways:
 *   - Strip "Apify:" name prefix on existing MCPs
 *   - Generate and store llms.txt markdown per MCP
 *
 * Usage:
 *   npm run maintain:apify-mcps -- --dry-run
 *   npm run maintain:apify-mcps -- --rename
 *   npm run maintain:apify-mcps -- --llms
 *   npm run maintain:apify-mcps -- --all
 *   npm run maintain:apify-mcps -- --all --limit 50
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PremanClient } from "../dist/index.js";
import { readConfig } from "../dist/config.js";
import {
  apifyActorIdFromUpstream,
  generateHostedMcpLlmsTxt,
  hasApifyNamePrefix,
  isApifyHostedMcp,
  stripApifyNamePrefix,
} from "../dist/llms.js";

type CliOptions = {
  dryRun: boolean;
  rename: boolean;
  llms: boolean;
  limit?: number;
  delayMs: number;
};

function parseArgs(argv: string[]): CliOptions {
  const all = hasFlag(argv, "--all");
  const rename = all || hasFlag(argv, "--rename");
  const llms = all || hasFlag(argv, "--llms");
  if (!rename && !llms) {
    throw new Error("Specify --rename, --llms, or --all.");
  }

  const limitRaw = valueFor(argv, "--limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limitRaw && (!Number.isFinite(limit) || (limit ?? 0) < 1)) {
    throw new Error("--limit must be a positive number.");
  }

  return {
    dryRun: hasFlag(argv, "--dry-run"),
    rename,
    llms,
    limit,
    delayMs: Math.max(0, Number(valueFor(argv, "--delay-ms") ?? "200")),
  };
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function loadEnvFile(path: string): Promise<void> {
  if (!existsSync(path)) return;
  const raw = await readFile(path, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key) continue;
    process.env[key] = value;
  }
}

async function resolveCredentials(): Promise<{ apiKey: string; apiUrl: string; appUrl: string }> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  await loadEnvFile(join(root, ".env"));
  const config = await readConfig();
  const apiKey = process.env["PREMAN_API_KEY"]?.trim() || config.apiKey?.trim();
  if (!apiKey) {
    throw new Error("PREMAN_API_KEY is required in .env or ~/.preman/config.json");
  }
  return {
    apiKey,
    apiUrl: process.env["PREMAN_API_URL"]?.trim() || config.apiUrl || "https://api.preman.live",
    appUrl: process.env["PREMAN_APP_URL"]?.trim() || config.appUrl || "https://app.preman.live",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toolsFromRecord(record: Record<string, unknown>): Array<{ name?: string; description?: string }> {
  const selection = record["endpoint_selection"];
  let parsed: unknown = selection;
  if (typeof selection === "string") {
    try {
      parsed = JSON.parse(selection);
    } catch {
      parsed = null;
    }
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const tools = (parsed as { tools?: unknown[] }).tools;
    if (Array.isArray(tools)) {
      return tools.map((item) => {
        const tool = item as { name?: string; description?: string };
        return { name: tool.name, description: tool.description };
      });
    }
  }
  const rowTools = record["tools"];
  if (Array.isArray(rowTools)) {
    return rowTools.map((item) => {
      const tool = item as { name?: string; description?: string };
      return { name: tool.name, description: tool.description };
    });
  }
  return [];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const credentials = await resolveCredentials();
  const client = new PremanClient({
    apiKey: credentials.apiKey,
    apiUrl: credentials.apiUrl,
    appUrl: credentials.appUrl,
    timeoutMs: 120_000,
    retry: { retries: 2, retryUnsafe: true },
  });

  const listed = await client.listHostedMcps();
  let targets = listed.hostedMcps.filter((row) => {
    const record = row as Record<string, unknown>;
    const name = String(record["name"] ?? "");
    if (options.rename && hasApifyNamePrefix(name)) {
      return true;
    }
    if (options.llms && isApifyHostedMcp(record as { name?: string; upstream_base_url?: string })) {
      return true;
    }
    return false;
  });
  if (options.limit) {
    targets = targets.slice(0, options.limit);
  }

  console.log(`Found ${targets.length} Apify-hosted MCP(s) to process (dry-run=${options.dryRun}).`);

  let renamed = 0;
  let llmsUpdated = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, row] of targets.entries()) {
    const record = row as Record<string, unknown>;
    const mcpId = String(record["id"] ?? "");
    const currentName = String(record["name"] ?? "");
    const upstream = String(record["upstream_base_url"] ?? "");
    const label = `[${index + 1}/${targets.length}] ${mcpId} — ${currentName}`;

    if (!mcpId) {
      skipped += 1;
      console.warn(`${label} skipped (missing id)`);
      continue;
    }

    const nextName = stripApifyNamePrefix(currentName);
    const needsRename = options.rename && currentName !== nextName;

    let existingLlms = typeof record["llms_txt_markdown"] === "string"
      ? record["llms_txt_markdown"]
      : "";
    let tools = toolsFromRecord(record);
    if (options.llms && !existingLlms.trim()) {
      try {
        const detail = await client.getHostedMcp(mcpId);
        const detailRecord = detail.hostedMcp as Record<string, unknown>;
        existingLlms = typeof detailRecord["llms_txt_markdown"] === "string"
          ? detailRecord["llms_txt_markdown"]
          : "";
        tools = toolsFromRecord(detailRecord);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`${label} could not load detail for llms check: ${message}`);
      }
    }

    const generatedLlms = generateHostedMcpLlmsTxt({
      name: nextName,
      mcpId,
      apiUrl: credentials.apiUrl,
      appUrl: credentials.appUrl,
      upstreamBaseUrl: upstream,
      apifyActorId: apifyActorIdFromUpstream(upstream),
      tools,
    });
    const needsLlms = options.llms && existingLlms.trim() !== generatedLlms.trim();

    if (!needsRename && !needsLlms) {
      skipped += 1;
      continue;
    }

    if (options.dryRun) {
      if (needsRename) {
        renamed += 1;
        console.log(`${label} would rename -> "${nextName}"`);
      }
      if (needsLlms) {
        llmsUpdated += 1;
        console.log(`${label} would update llms.txt (${generatedLlms.length} chars)`);
      }
      continue;
    }

    try {
      const detail = needsLlms || options.llms
        ? await client.getHostedMcp(mcpId)
        : null;
      const detailRecord = detail?.hostedMcp as Record<string, unknown> | undefined;
      const llmsTools = detailRecord ? toolsFromRecord(detailRecord) : tools;
      const llmsTxtMarkdown = options.llms && needsLlms
        ? generateHostedMcpLlmsTxt({
          name: nextName,
          mcpId,
          apiUrl: credentials.apiUrl,
          appUrl: credentials.appUrl,
          upstreamBaseUrl: upstream,
          apifyActorId: apifyActorIdFromUpstream(upstream),
          tools: llmsTools,
        })
        : undefined;

      await client.updateHostedMcp({
        mcpId,
        ...(needsRename ? { name: nextName } : {}),
        ...(needsLlms ? { llmsTxtMarkdown } : {}),
      });

      if (needsRename) renamed += 1;
      if (needsLlms) llmsUpdated += 1;
      console.log(`${label} updated${needsRename ? " (renamed)" : ""}${needsLlms ? " (llms)" : ""}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${label} failed: ${message}`);
    }

    if (options.delayMs > 0 && index < targets.length - 1) {
      await sleep(options.delayMs);
    }
  }

  console.log("");
  console.log(
    `Done. renamed=${renamed} llms_updated=${llmsUpdated} skipped=${skipped} failed=${failed} dry-run=${options.dryRun}`,
  );
  if (failed > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
