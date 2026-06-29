import type {
  DeployMcpRequest,
  PremanCapabilities,
  UpstreamBuildConfig,
  UpstreamHostingCapabilities,
  UpstreamHostingRecord,
  UpstreamHostingRuntimeStatus,
  UpstreamMode,
} from "./types.js";
import { PremanConfigError } from "./errors.js";
import { isLocalUpstreamUrl, localUpstreamMessage } from "./upstream.js";

/** Discriminator for external (operator-hosted) upstream APIs. */
export const UPSTREAM_MODE_EXTERNAL = "external" as const satisfies UpstreamMode;

/** Discriminator when PreMan builds and runs the operator's upstream container. */
export const UPSTREAM_MODE_PREMAN = "preman" as const satisfies UpstreamMode;

/** Stable feature id agents can search for in SDK docs and capability payloads. */
export const PREMAN_UPSTREAM_HOSTING_FEATURE_ID = "preman_upstream_hosting" as const;

/** API route PreMan exposes for capability discovery (GET). */
export const PREMAN_CAPABILITIES_PATH = "/capabilities" as const;

/** API route for upstream workload status on a hosted MCP (GET). */
export const PREMAN_UPSTREAM_HOSTING_STATUS_PATH = "/hosted-mcps/{mcpId}/upstream-hosting" as const;

/**
 * Agent-oriented guide for choosing upstream hosting during deploy.
 * Import this constant when generating deploy plans or onboarding flows.
 */
export const AGENT_UPSTREAM_HOSTING_GUIDE = `PreMan hosted MCPs use two URLs:
1. hostedUrl — the MCP endpoint agents connect to (PreMan provides this).
2. upstream — the HTTP API that implements tool logic.

Upstream hosting modes (call client.getCapabilities() first):
- external (default): Operator supplies upstreamBaseUrl. PreMan proxies tool calls there.
  Use when you already host the API or use your own tunnel/PaaS.
- preman: Operator supplies upstreamBuild (container image or Dockerfile). PreMan provisions
  and manages the upstream URL. No HOST_UPSTREAM_URL or local tunnel required.

Discovery flow for agents:
  const caps = await client.getCapabilities();
  if (caps.upstreamHosting.supported && caps.upstreamHosting.modes.includes("preman")) {
    await client.deployMcp({ upstreamMode: "preman", upstreamBuild: { dockerfile: "Dockerfile" }, ... });
    await client.waitForUpstreamHosting({ mcpId }); // optional, when status is building
  } else {
    await client.deployMcp({ upstreamMode: "external", upstreamBaseUrl: "https://...", ... });
  }

OAuth callbacks stay on PreMan (/hosted-mcps/upstream-oauth/callback) regardless of upstream mode.
`;

export function defaultPremanCapabilities(): PremanCapabilities {
  return {
    upstreamHosting: {
      featureId: PREMAN_UPSTREAM_HOSTING_FEATURE_ID,
      supported: false,
      modes: [UPSTREAM_MODE_EXTERNAL],
      defaultMode: UPSTREAM_MODE_EXTERNAL,
      supportsDockerfileBuild: false,
      supportsImageDeploy: false,
      supportsBuildContextUrl: false,
    },
  };
}

export function normalizePremanCapabilities(raw: Record<string, unknown>): PremanCapabilities {
  const upstreamHostingRaw = objectSection(raw, "upstream_hosting")
    ?? objectSection(raw, "upstreamHosting")
    ?? {};
  const modes = stringArray(
    upstreamHostingRaw["modes"] ?? raw["upstream_modes"],
    [UPSTREAM_MODE_EXTERNAL],
  ).filter((mode): mode is UpstreamMode => mode === UPSTREAM_MODE_EXTERNAL || mode === UPSTREAM_MODE_PREMAN);

  const upstreamHosting: UpstreamHostingCapabilities = {
    featureId: PREMAN_UPSTREAM_HOSTING_FEATURE_ID,
    supported: booleanAt(upstreamHostingRaw, "supported") || modes.includes(UPSTREAM_MODE_PREMAN),
    modes: modes.length ? modes : [UPSTREAM_MODE_EXTERNAL],
    defaultMode: readUpstreamMode(upstreamHostingRaw["default_mode"] ?? upstreamHostingRaw["defaultMode"]) ?? UPSTREAM_MODE_EXTERNAL,
    supportsDockerfileBuild: booleanAt(upstreamHostingRaw, "supports_dockerfile_build") || booleanAt(upstreamHostingRaw, "supportsDockerfileBuild"),
    supportsImageDeploy: booleanAt(upstreamHostingRaw, "supports_image_deploy") || booleanAt(upstreamHostingRaw, "supportsImageDeploy"),
    supportsBuildContextUrl: booleanAt(upstreamHostingRaw, "supports_build_context_url") || booleanAt(upstreamHostingRaw, "supportsBuildContextUrl"),
  };

  return {
    version: stringAt(raw, "version") || undefined,
    upstreamHosting,
    raw,
  };
}

export function supportsPremanUpstreamHosting(capabilities: PremanCapabilities): boolean {
  return capabilities.upstreamHosting.supported && capabilities.upstreamHosting.modes.includes(UPSTREAM_MODE_PREMAN);
}

export function resolveUpstreamMode(request: Pick<DeployMcpRequest, "upstreamMode">): UpstreamMode {
  return request.upstreamMode ?? UPSTREAM_MODE_EXTERNAL;
}

export function validateUpstreamDeployRequest(request: DeployMcpRequest): void {
  const mode = resolveUpstreamMode(request);
  if (mode === UPSTREAM_MODE_EXTERNAL) {
    if (!request.upstreamBaseUrl?.trim()) {
      throw new PremanConfigError(
        "deployMcp requires upstreamBaseUrl when upstreamMode is \"external\". " +
          "Call getCapabilities() and use upstreamMode \"preman\" with upstreamBuild when PreMan upstream hosting is available.",
      );
    }
    return;
  }

  if (!request.upstreamBuild) {
    throw new PremanConfigError(
      "deployMcp requires upstreamBuild when upstreamMode is \"preman\". " +
        "Provide upstreamBuild.image or upstreamBuild.dockerfile.",
    );
  }

  const build = request.upstreamBuild;
  const hasImage = Boolean(build.image?.trim());
  const hasDockerfile = Boolean(build.dockerfile?.trim());
  const hasContextUrl = Boolean(build.buildContextUrl?.trim());
  if (!hasImage && !hasDockerfile && !hasContextUrl) {
    throw new PremanConfigError(
      "upstreamBuild requires at least one of: image, dockerfile, buildContextUrl.",
    );
  }
}

export function buildUpstreamDeployBody(
  request: DeployMcpRequest,
): Record<string, unknown> {
  validateUpstreamDeployRequest(request);
  const mode = resolveUpstreamMode(request);
  const body: Record<string, unknown> = {
    upstream_mode: mode,
  };

  if (mode === UPSTREAM_MODE_EXTERNAL) {
    body.upstream_base_url = request.upstreamBaseUrl;
    return body;
  }

  body.upstream_build = toBackendUpstreamBuild(request.upstreamBuild!);
  if (request.upstreamBaseUrl) {
    body.upstream_base_url = request.upstreamBaseUrl;
  }
  return body;
}

export function toBackendUpstreamBuild(config: UpstreamBuildConfig): Record<string, unknown> {
  return omitUndefined({
    image: config.image,
    dockerfile: config.dockerfile,
    context_path: config.contextPath ?? config.context_path,
    build_context_url: config.buildContextUrl ?? config.build_context_url,
    port: config.port,
    health_path: config.healthPath ?? config.health_path,
    env: config.env,
    secret_names: config.secretNames ?? config.secret_names,
  });
}

export function normalizeUpstreamHostingRecord(
  mcpId: string,
  raw: Record<string, unknown>,
): UpstreamHostingRecord {
  const mode = readUpstreamMode(raw["upstream_mode"] ?? raw["upstreamMode"]) ?? UPSTREAM_MODE_EXTERNAL;
  const status = readUpstreamHostingStatus(raw["status"] ?? raw["upstream_status"] ?? raw["upstreamStatus"]) ?? "unknown";
  return {
    mcpId,
    upstreamMode: mode,
    status,
    upstreamBaseUrl: nullableString(raw["upstream_base_url"] ?? raw["upstreamBaseUrl"]),
    publicUrl: nullableString(raw["public_url"] ?? raw["publicUrl"]),
    buildId: nullableString(raw["build_id"] ?? raw["buildId"]),
    message: nullableString(raw["message"]),
    raw,
  };
}

export type ResolveUpstreamDeployPlanInput = {
  capabilities?: PremanCapabilities;
  preferPremanHosting?: boolean;
  externalUpstreamUrl?: string;
  upstreamBuild?: UpstreamBuildConfig;
  allowLocalExternal?: boolean;
};

export type ResolveUpstreamDeployPlanResult = {
  upstreamMode: UpstreamMode;
  upstreamBaseUrl?: string;
  upstreamBuild?: UpstreamBuildConfig;
  capabilities: PremanCapabilities;
  guidance: string;
};

/**
 * Pick upstreamMode and related deploy fields for agent-driven deploy flows.
 * Pass capabilities from client.getCapabilities() when available.
 */
export function resolveUpstreamDeployPlan(input: ResolveUpstreamDeployPlanInput): ResolveUpstreamDeployPlanResult {
  const capabilities = input.capabilities ?? defaultPremanCapabilities();
  const premanAvailable = supportsPremanUpstreamHosting(capabilities);
  const wantsPreman = input.preferPremanHosting ?? false;

  if (wantsPreman && premanAvailable && input.upstreamBuild) {
    return {
      upstreamMode: UPSTREAM_MODE_PREMAN,
      upstreamBuild: input.upstreamBuild,
      capabilities,
      guidance: "Using PreMan upstream hosting. Poll getUpstreamHostingStatus() until status is running.",
    };
  }

  if (wantsPreman && !premanAvailable) {
    if (!input.externalUpstreamUrl?.trim()) {
      throw new PremanConfigError(
        "PreMan upstream hosting is not available on this API. Provide externalUpstreamUrl or deploy to an API that supports upstream_mode=preman.",
      );
    }
  }

  const externalUrl = input.externalUpstreamUrl?.trim();
  if (!externalUrl) {
    throw new PremanConfigError(
      premanAvailable
        ? "Provide externalUpstreamUrl or set preferPremanHosting with upstreamBuild."
        : "Provide externalUpstreamUrl. PreMan upstream hosting is not available on this API.",
    );
  }

  if (!input.allowLocalExternal && isLocalUpstreamUrl(externalUrl)) {
    throw new PremanConfigError(localUpstreamMessage(externalUrl));
  }

  return {
    upstreamMode: UPSTREAM_MODE_EXTERNAL,
    upstreamBaseUrl: externalUrl,
    capabilities,
    guidance: premanAvailable
      ? "Using external upstream. Re-run with preferPremanHosting and upstreamBuild to avoid tunnels."
      : "Using external upstream. Call getCapabilities() after API upgrade to check for preman upstream hosting.",
  };
}

function readUpstreamMode(value: unknown): UpstreamMode | undefined {
  if (value === UPSTREAM_MODE_EXTERNAL || value === UPSTREAM_MODE_PREMAN) return value;
  return undefined;
}

function readUpstreamHostingStatus(value: unknown): UpstreamHostingRuntimeStatus | undefined {
  if (
    value === "pending"
    || value === "building"
    || value === "running"
    || value === "failed"
    || value === "stopped"
    || value === "unknown"
  ) {
    return value;
  }
  return undefined;
}

function objectSection(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const item = value[key];
  return item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : undefined;
}

function stringAt(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  return typeof item === "string" ? item : "";
}

function booleanAt(value: Record<string, unknown>, key: string): boolean {
  return value[key] === true;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function nullableString(value: unknown): string | null | undefined {
  return typeof value === "string" ? value : value === null ? null : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
