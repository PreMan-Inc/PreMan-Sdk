/**
 * Import the most popular Apify Store Actors as PreMan hosted MCP gateways.
 *
 * Each Actor becomes a PreMan proxy in front of Apify's hosted MCP server with
 * that Actor pinned as a tool (`https://mcp.apify.com?tools=...`).
 *
 * Usage:
 *   # Put PREMAN_API_KEY and APIFY_TOKEN in .env (see .env.example), then:
 *   npm run setup:apify-mcps
 *   npm run setup:apify-mcps -- --limit 1
 *   npx tsx examples/setup-apify-mcps.ts
 *   npx tsx examples/setup-apify-mcps.ts --limit 50 --dry-run
 *   npx tsx examples/setup-apify-mcps.ts --concurrency 2 --resume results.json
 *   npx tsx examples/setup-apify-mcps.ts --delay-ms 300 --max-retries 3
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "../dist/config.js";
import { PremanAuthError, PremanClient } from "../dist/index.js";
import { generateHostedMcpLlmsTxt } from "../dist/llms.js";

const APIFY_STORE_URL = "https://api.apify.com/v2/store";
const APIFY_MCP_BASE = "https://mcp.apify.com";
const PROD_PREMAN_API_URL = "https://api.preman.live";
const DEV_PREMAN_API_URL = "https://api-dev.preman.live";

type ApifyStoreActor = {
  title: string;
  name: string;
  username: string;
  stats?: { totalUsers?: number };
};

type SetupResult = {
  actorId: string;
  title: string;
  totalUsers?: number;
  status: "imported" | "skipped" | "failed" | "dry-run";
  mcpId?: string;
  hostedUrl?: string | null;
  dashboardUrl?: string;
  error?: string;
};

type ProgressFile = {
  startedAt: string;
  updatedAt: string;
  limit: number;
  results: SetupResult[];
};

type CliOptions = {
  limit: number;
  dryRun: boolean;
  concurrency: number;
  delayMs: number;
  maxRetries: number;
  skipExisting: boolean;
  resumePath?: string;
  outputPath: string;
};

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_DELAY_MS = 300;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;

function parseArgs(argv: string[]): CliOptions {
  const limit = Number(valueFor(argv, "--limit") ?? "1300");
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("--limit must be a positive number.");
  }

  const concurrency = Math.max(1, Number(valueFor(argv, "--concurrency") ?? String(DEFAULT_CONCURRENCY)));
  const delayMs = Math.max(0, Number(valueFor(argv, "--delay-ms") ?? String(DEFAULT_DELAY_MS)));
  const maxRetries = Math.max(0, Number(valueFor(argv, "--max-retries") ?? String(DEFAULT_MAX_RETRIES)));

  return {
    limit,
    dryRun: hasFlag(argv, "--dry-run"),
    concurrency,
    delayMs,
    maxRetries,
    skipExisting: !hasFlag(argv, "--no-skip-existing"),
    resumePath: valueFor(argv, "--resume"),
    outputPath: valueFor(argv, "--output") ?? "apify-mcps-setup.json",
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

async function resolveApifyToken(): Promise<string | undefined> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  await loadEnvFile(join(root, ".env"));
  return (
    process.env["APIFY_TOKEN"]?.trim()
    || process.env["APIFY_API_TOKEN"]?.trim()
  );
}

async function validatePremanApi(client: PremanClient, apiUrl: string, apiKey: string): Promise<void> {
  try {
    await client.listHostedMcps();
    return;
  } catch (error) {
    if (!(error instanceof PremanAuthError)) {
      throw error;
    }

    if (apiUrl === PROD_PREMAN_API_URL) {
      const devCheck = await fetch(`${DEV_PREMAN_API_URL}/hosted-mcps`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (devCheck.ok) {
        throw new Error(
          "PREMAN_API_KEY is valid on api-dev.preman.live but PREMAN_API_URL points at production. "
          + "Set PREMAN_API_URL=https://api-dev.preman.live in .env for dev keys.",
        );
      }
    }

    throw error;
  }
}

function requireApifyToken(token: string | undefined): string {
  if (token?.startsWith("apify_api_")) {
    return token;
  }
  throw new Error(
    "APIFY_TOKEN is required to import Actor-specific Apify MCP gateways. "
    + "Add APIFY_TOKEN=apify_api_... to .env (create one at https://console.apify.com/account/integrations).",
  );
}

async function resolvePremanCredentials(): Promise<{ apiKey?: string; apiUrl?: string; appUrl?: string }> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  await loadEnvFile(join(root, ".env"));

  const config = await readConfig();
  return {
    apiKey: process.env["PREMAN_API_KEY"]?.trim() || config.apiKey?.trim(),
    apiUrl: process.env["PREMAN_API_URL"]?.trim() || config.apiUrl,
    appUrl: process.env["PREMAN_APP_URL"]?.trim() || config.appUrl,
  };
}

function actorId(actor: ApifyStoreActor): string {
  return `${actor.username}/${actor.name}`;
}

function slugFor(actor: ApifyStoreActor): string {
  return actorId(actor).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function apifyMcpUrl(actor: ApifyStoreActor): string {
  return `${APIFY_MCP_BASE}?tools=${actorId(actor)}`;
}

async function fetchPopularActors(limit: number): Promise<ApifyStoreActor[]> {
  const actors: ApifyStoreActor[] = [];
  const pageSize = 1000;

  while (actors.length < limit) {
    const batchLimit = Math.min(pageSize, limit - actors.length);
    const url = new URL(APIFY_STORE_URL);
    url.searchParams.set("sort_by", "popularity");
    url.searchParams.set("desc", "1");
    url.searchParams.set("limit", String(batchLimit));
    url.searchParams.set("offset", String(actors.length));

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Apify Store request failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json() as { data?: { items?: ApifyStoreActor[] } };
    const items = payload.data?.items ?? [];
    if (!items.length) break;
    actors.push(...items);
  }

  return actors.slice(0, limit);
}

async function loadProgress(path: string): Promise<ProgressFile | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as ProgressFile;
  } catch {
    return undefined;
  }
}

async function saveProgress(path: string, progress: ProgressFile): Promise<void> {
  await mkdir(path.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(path, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableImportError(message: string): boolean {
  return /HTTP 400|HTTP 429|rate limit/i.test(message);
}

async function withImportRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  label: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxRetries || !isRetryableImportError(message)) {
        throw error;
      }

      const delayMs = RETRY_BASE_DELAY_MS * 2 ** attempt;
      console.warn(`${label} retry ${attempt + 1}/${maxRetries} in ${delayMs}ms (${message})`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function upsertResult(results: SetupResult[], result: SetupResult): void {
  const index = results.findIndex((item) => item.actorId === result.actorId);
  if (index === -1) {
    results.push(result);
    return;
  }
  results[index] = result;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

function existingSlugSet(hostedMcps: Array<Record<string, unknown>>): Set<string> {
  const slugs = new Set<string>();
  for (const mcp of hostedMcps) {
    const slug = typeof mcp["slug"] === "string" ? mcp["slug"] : "";
    const name = typeof mcp["name"] === "string" ? mcp["name"] : "";
    if (slug) slugs.add(slug);
    if (name.startsWith("Apify: ")) {
      const stripped = name.slice("Apify: ".length);
      slugs.add(stripped.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase());
    }
  }
  return slugs;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const credentials = await resolvePremanCredentials();
  const apifyToken = options.dryRun ? await resolveApifyToken() : requireApifyToken(await resolveApifyToken());

  console.log(`Fetching top ${options.limit} Apify Store Actors by popularity...`);
  const actors = await fetchPopularActors(options.limit);
  console.log(`Loaded ${actors.length} Actors.`);

  const resume = options.resumePath ? await loadProgress(options.resumePath) : undefined;
  const completed = new Map(
    (resume?.results ?? [])
      .filter((item) => item.status === "imported" || item.status === "skipped")
      .map((item) => [item.actorId, item]),
  );

  let knownSlugs = new Set<string>();
  let preman: PremanClient | undefined;

  if (!options.dryRun) {
    preman = new PremanClient({
      apiKey: credentials.apiKey,
      apiUrl: credentials.apiUrl,
      appUrl: credentials.appUrl,
      timeoutMs: 120_000,
      retry: { retries: 2, retryUnsafe: true },
    });
    await validatePremanApi(preman, credentials.apiUrl ?? PROD_PREMAN_API_URL, credentials.apiKey ?? "");

    if (options.skipExisting) {
      const listed = await preman.listHostedMcps();
      knownSlugs = existingSlugSet(listed.hostedMcps);
      console.log(`Found ${knownSlugs.size} existing hosted MCP slug hints to skip.`);
    }
  }

  const resumedFailed = (resume?.results ?? []).filter((item) => item.status === "failed").length;
  const progress: ProgressFile = {
    startedAt: resume?.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    limit: options.limit,
    results: (resume?.results ?? []).filter((item) => item.status !== "failed"),
  };

  const pending = actors.filter((actor) => !completed.has(actorId(actor)));
  console.log(
    `${pending.length} Actors pending import (${completed.size} done, ${resumedFailed} failed will retry).`,
  );
  if (options.delayMs > 0) {
    console.log(`Inter-import delay: ${options.delayMs}ms, max retries: ${options.maxRetries}.`);
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let progressLock = Promise.resolve();

  async function recordResult(result: SetupResult): Promise<void> {
    const prev = progressLock;
    let release!: () => void;
    progressLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      upsertResult(progress.results, result);
      progress.updatedAt = new Date().toISOString();
      await saveProgress(options.outputPath, progress);
    } finally {
      release();
    }
  }

  await mapPool(pending, options.concurrency, async (actor, index) => {
    if (options.delayMs > 0 && index > 0) {
      await sleep(options.delayMs);
    }
    const id = actorId(actor);
    const slug = slugFor(actor);
    const label = `[${index + 1}/${pending.length}] ${id} (${actor.stats?.totalUsers?.toLocaleString() ?? "?"} users)`;

    if (options.skipExisting && knownSlugs.has(slug)) {
      const result: SetupResult = {
        actorId: id,
        title: actor.title,
        totalUsers: actor.stats?.totalUsers,
        status: "skipped",
      };
      await recordResult(result);
      skipped += 1;
      console.log(`${label} skipped (already exists)`);
      return;
    }

    if (options.dryRun) {
      const result: SetupResult = {
        actorId: id,
        title: actor.title,
        totalUsers: actor.stats?.totalUsers,
        status: "dry-run",
      };
      await recordResult(result);
      console.log(`${label} dry-run -> ${apifyMcpUrl(actor)}`);
      return;
    }

    try {
      const importedMcp = await withImportRetry(
        () => preman!.importRemoteMcp({
          mcpUrl: apifyMcpUrl(actor),
          name: actor.title,
          slug,
          upstreamAuthStyle: { type: "header", name: "Authorization", prefix: "Bearer " },
          initialUpstreamSecret: apifyToken,
          initialUpstreamSecretType: "bearer",
          request: { idempotencyKey: `apify-mcp-${slug}` },
        }),
        options.maxRetries,
        label,
      );

      if (importedMcp.mcpId) {
        const llmsTxtMarkdown = generateHostedMcpLlmsTxt({
          name: actor.title,
          mcpId: importedMcp.mcpId,
          apiUrl: credentials.apiUrl ?? PROD_PREMAN_API_URL,
          appUrl: credentials.appUrl,
          upstreamBaseUrl: apifyMcpUrl(actor),
          apifyActorId: id,
        });
        try {
          await preman!.updateHostedMcp({
            mcpId: importedMcp.mcpId,
            llmsTxtMarkdown,
          });
        } catch (llmsError) {
          const message = llmsError instanceof Error ? llmsError.message : String(llmsError);
          console.warn(`${label} imported but llms.txt upload failed: ${message}`);
        }
      }

      const result: SetupResult = {
        actorId: id,
        title: actor.title,
        totalUsers: actor.stats?.totalUsers,
        status: "imported",
        mcpId: importedMcp.mcpId,
        hostedUrl: importedMcp.hostedUrl,
        dashboardUrl: importedMcp.dashboardUrl,
      };
      await recordResult(result);
      knownSlugs.add(slug);
      imported += 1;
      console.log(`${label} imported -> ${importedMcp.hostedUrl ?? importedMcp.dashboardUrl ?? importedMcp.mcpId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordResult({
        actorId: id,
        title: actor.title,
        totalUsers: actor.stats?.totalUsers,
        status: "failed",
        error: message,
      });
      failed += 1;
      console.error(`${label} failed: ${message}`);
    }
  });

  progress.updatedAt = new Date().toISOString();
  await saveProgress(options.outputPath, progress);

  console.log("");
  console.log(`Done. imported=${imported} skipped=${skipped} failed=${failed} dry-run=${options.dryRun}`);
  console.log(`Progress saved to ${options.outputPath}`);

  if (failed > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
