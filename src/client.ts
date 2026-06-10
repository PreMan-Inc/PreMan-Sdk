import {
  type AuditEvent,
  type AuditLogResponse,
  type CreateTokenRequest,
  type CreateTokenResponse,
  type DeployMcpRequest,
  type DeployMcpResponse,
  type CreateLocalStdioTunnelRequest,
  type HostedMcpInstallSnippet,
  type GetHostedMcpResponse,
  type HostedMcpImportResponse,
  type HostedMcpRecord,
  type GetHostedMcpCatalogResponse,
  type ImportFromDocsRequest,
  type ImportRemoteMcpRequest,
  type LocalStdioTunnelPollRequest,
  type LocalStdioTunnelPollResponse,
  type LocalStdioTunnelResponse,
  type ListHostedMcpsResponse,
  type ListTokensRequest,
  type ListTokensResponse,
  type PremanClientOptions,
  type RegisterEndpointsRequest,
  type RegisterEndpointsResponse,
  type RequestOptions,
  type RetryOptions,
  type RevokeTokenRequest,
  type RevokeTokenResponse,
  type RotateTokenRequest,
  type RotateTokenResponse,
  type SendLocalStdioTunnelMessageRequest,
  type TokenMetadata,
  type UpdateLocalStdioTunnelStatusRequest,
  type VerifyTokenRequest,
  type VerifyTokenResponse,
} from "./types.js";
import { PremanAuthError, PremanConfigError, PremanError, PremanPolicyDeniedError } from "./errors.js";
import { normalizeHostedMcpCatalog } from "./catalog.js";
import { randomUUID } from "node:crypto";

const DEFAULT_API_URL = "https://api.preman.live";
const DEFAULT_APP_URL = "https://app.preman.live";

export class PremanClient {
  readonly apiUrl: string;
  readonly appUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retry: Required<RetryOptions>;
  private readonly hooks: PremanClientOptions["hooks"];

  constructor(options: PremanClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env["PREMAN_API_KEY"] ?? "";
    if (!apiKey.trim()) {
      throw new PremanConfigError(
        "Missing API key. Create one at https://app.preman.live/settings, then run `preman init --api-key pm_live_...` or set PREMAN_API_KEY.",
      );
    }
    if (!apiKey.startsWith("pm_live_")) {
      throw new PremanConfigError(
        "Invalid API key format. The SDK currently uses PreMan workspace API keys that start with `pm_live_`. Create one at https://app.preman.live/settings. Do not use a hosted MCP consumer token (`pm_hmcp_...`) or a login JWT.",
      );
    }

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new PremanConfigError("No fetch implementation available. Use Node >=18 or pass fetchImpl.");
    }

    this.apiKey = apiKey;
    this.apiUrl = stripTrailingSlash(options.apiUrl ?? process.env["PREMAN_API_URL"] ?? DEFAULT_API_URL);
    this.appUrl = stripTrailingSlash(options.appUrl ?? process.env["PREMAN_APP_URL"] ?? DEFAULT_APP_URL);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retry = normalizeRetry(options.retry);
    this.hooks = options.hooks;
  }

  async registerEndpoints(request: RegisterEndpointsRequest): Promise<RegisterEndpointsResponse> {
    requireNonEmptyArray(request.endpoints, "endpoints");
    const sessionId = request.sessionId ?? randomUUID();
    const response = await this.request<{ id: string; endpoint_count: number }>(`/agent-sessions/${encodeURIComponent(sessionId)}/endpoints`, {
      method: "POST",
      body: {
        endpoints: request.endpoints.map(toBackendEndpoint),
        upstream_base_url: request.upstreamBaseUrl,
        intent: request.intent,
      },
      request: request.request,
    });
    const id = response.id || sessionId;
    const dashboardUrl = this.dashboardUrl(`/try?session=${encodeURIComponent(id)}`);
    return {
      sessionId: id,
      endpointCount: response.endpoint_count ?? request.endpoints.length,
      dashboardUrl,
      endpointsUrl: dashboardUrl,
    };
  }

  async deployMcp(request: DeployMcpRequest): Promise<DeployMcpResponse> {
    requireString(request.name, "name");
    requireString(request.upstreamBaseUrl, "upstreamBaseUrl");
    if (!request.endpoints?.length) {
      throw new PremanConfigError("deployMcp requires endpoints.");
    }
    const sessionId = request.sessionId ?? randomUUID();
    const response = await this.request<Record<string, unknown>>(`/agent-sessions/${encodeURIComponent(sessionId)}/mcp/deploy`, {
      method: "POST",
      body: {
        name: request.name,
        upstream_base_url: request.upstreamBaseUrl,
        endpoints: request.endpoints.map(toBackendEndpoint),
        initial_upstream_secret: request.initialUpstreamSecret,
        initial_upstream_secret_type: request.initialUpstreamSecretType,
        upstream_auth_style: request.upstreamAuthStyle,
        initial_consumer_label: request.initialConsumerLabel === undefined ? "default-consumer" : request.initialConsumerLabel,
      },
      request: request.request,
    });
    const hosted = objectAt(response, "hosted_mcp");
    const mcpId = stringAt(hosted, "id");
    const name = stringAt(hosted, "name") || request.name;
    const hostedUrl = stringAt(response, "hosted_mcp_url");
    return {
      mcpId,
      name,
      hostedUrl,
      dashboardUrl: this.dashboardUrl(`/hosted-mcps/${encodeURIComponent(mcpId)}`),
      toolCount: numberAt(response, "tool_count"),
      rawConsumerToken: nullableStringAt(response, "raw_consumer_token"),
      consumerToken: objectAt(response, "consumer_token"),
      installSnippet: normalizeInstallSnippet(objectAt(response, "install_snippet")),
    };
  }

  async importFromDocs(request: ImportFromDocsRequest): Promise<HostedMcpImportResponse> {
    requireString(request.docsUrl, "docsUrl");
    const response = await this.request<Record<string, unknown>>("/hosted-mcps/import-from-docs", {
      method: "POST",
      body: omitUndefined({
        docs_url: request.docsUrl,
        name: request.name,
        slug: request.slug,
        upstream_base_url: request.upstreamBaseUrl,
        upstream_auth_style: request.upstreamAuthStyle,
        initial_upstream_secret: request.initialUpstreamSecret,
        initial_upstream_secret_type: request.initialUpstreamSecretType,
        access_mode: request.accessMode,
        max_endpoints: request.maxEndpoints,
        deploy: request.deploy,
      }),
      request: request.request,
    });
    return normalizeHostedMcpImport(response, this.appUrl);
  }

  async importRemoteMcp(request: ImportRemoteMcpRequest): Promise<HostedMcpImportResponse> {
    requireString(request.mcpUrl, "mcpUrl");
    const response = await this.request<Record<string, unknown>>("/hosted-mcps/import-remote-mcp", {
      method: "POST",
      body: omitUndefined({
        mcp_url: request.mcpUrl,
        name: request.name,
        slug: request.slug,
        upstream_auth_style: request.upstreamAuthStyle,
        initial_upstream_secret: request.initialUpstreamSecret,
        initial_upstream_secret_type: request.initialUpstreamSecretType,
        access_mode: request.accessMode,
      }),
      request: request.request,
    });
    return normalizeHostedMcpImport(response, this.appUrl);
  }

  async createLocalStdioTunnel(request: CreateLocalStdioTunnelRequest): Promise<LocalStdioTunnelResponse> {
    requireString(request.name, "name");
    requireString(request.command, "command");
    const response = await this.request<Record<string, unknown>>("/hosted-mcps/local-stdio-tunnels", {
      method: "POST",
      body: omitUndefined({
        name: request.name,
        slug: request.slug,
        local_stdio: omitUndefined({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
          env_names: request.envNames,
        }),
        access_mode: request.accessMode,
        scopes: request.scopes,
      }),
      request: request.request,
    });
    return normalizeLocalStdioTunnel(response, this.appUrl);
  }

  async pollLocalStdioTunnelMessages(request: LocalStdioTunnelPollRequest): Promise<LocalStdioTunnelPollResponse> {
    requireString(request.tunnelId, "tunnelId");
    const response = await this.request<Record<string, unknown>>(
      `/hosted-mcps/local-stdio-tunnels/${encodeURIComponent(request.tunnelId)}/poll`,
      {
        method: "POST",
        body: omitUndefined({ wait_ms: request.waitMs }),
        request: request.request,
      },
    );
    return {
      messages: arrayOfObjectsAt(response, "messages").map(normalizeLocalStdioTunnelMessage),
      raw: response,
    };
  }

  async sendLocalStdioTunnelMessage(request: SendLocalStdioTunnelMessageRequest): Promise<void> {
    requireString(request.tunnelId, "tunnelId");
    await this.request<Record<string, unknown>>(
      `/hosted-mcps/local-stdio-tunnels/${encodeURIComponent(request.tunnelId)}/messages`,
      {
        method: "POST",
        body: { message: request.message },
        request: request.request,
      },
    );
  }

  async updateLocalStdioTunnelStatus(request: UpdateLocalStdioTunnelStatusRequest): Promise<void> {
    requireString(request.tunnelId, "tunnelId");
    await this.request<Record<string, unknown>>(
      `/hosted-mcps/local-stdio-tunnels/${encodeURIComponent(request.tunnelId)}/status`,
      {
        method: "POST",
        body: omitUndefined({
          status: request.status,
          detail: request.detail,
        }),
        request: request.request,
      },
    );
  }

  async listHostedMcps(): Promise<ListHostedMcpsResponse> {
    const response = await this.request<Record<string, unknown>>("/hosted-mcps", { method: "GET" });
    const hostedMcpsValue = response["hosted_mcps"];
    const hostedMcps = Array.isArray(hostedMcpsValue)
      ? hostedMcpsValue.filter((item): item is HostedMcpRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [];
    return {
      hostedMcps,
      total: numberAt(response, "total") || hostedMcps.length,
      raw: response,
    };
  }

  async getHostedMcp(mcpId: string): Promise<GetHostedMcpResponse> {
    requireString(mcpId, "mcpId");
    const response = await this.request<Record<string, unknown>>(`/hosted-mcps/${encodeURIComponent(mcpId)}`, {
      method: "GET",
    });
    return {
      hostedMcp: objectAt(response, "hosted_mcp") as HostedMcpRecord,
      raw: response,
    };
  }

  async getHostedMcpCatalog(mcpId: string): Promise<GetHostedMcpCatalogResponse> {
    const detail = await this.getHostedMcp(mcpId);
    return {
      catalog: normalizeHostedMcpCatalog(detail.raw),
      raw: detail.raw,
    };
  }

  async createToken(request: CreateTokenRequest): Promise<CreateTokenResponse> {
    requireString(request.mcpId, "mcpId");
    requireNonEmptyArray(request.scopes, "scopes");
    const response = await this.request<Record<string, unknown>>(`/hosted-mcps/${encodeURIComponent(request.mcpId)}/tokens`, {
      method: "POST",
      body: {
        consumer_label: request.consumerLabel ?? request.label ?? request.agentId ?? request.customerId ?? "sdk-consumer",
        upstream_credential_id: request.upstreamCredentialId,
        scopes: request.scopes,
        ttl_seconds: request.ttlSeconds,
        max_tool_calls: request.maxToolCalls,
        rate_limit_rpm: request.rateLimitRpm,
      },
      request: request.request,
    });
    const metadata = objectAt(response, "token");
    const rawToken = stringAt(response, "raw_token");
    return {
      token: rawToken,
      tokenId: stringAt(metadata, "id"),
      expiresAt: nullableStringAt(metadata, "expires_at"),
      metadata,
      installSnippet: normalizeInstallSnippet(objectAt(response, "install_snippet")),
    };
  }

  async verifyToken(request: VerifyTokenRequest): Promise<VerifyTokenResponse> {
    requireString(request.mcpId, "mcpId");
    requireString(request.token, "token");
    const response = await this.request<Record<string, unknown>>(
      `/hosted-mcps/${encodeURIComponent(request.mcpId)}/tokens/verify`,
      {
        method: "POST",
        body: omitUndefined({
          token: request.token,
          required_scope: request.requiredScope,
        }),
        request: request.request,
      },
    );

    const valid = response["valid"];
    if (typeof valid !== "boolean") {
      throw new PremanError("Invalid verifyToken response from PreMan API: expected boolean `valid` field.", {
        body: response,
      });
    }

    const identity = normalizeVerifyTokenIdentity(objectAt(response, "identity"));
    const topLevelIdentity = normalizeVerifyTokenIdentity(response);
    const normalizedIdentity = omitUndefined({
      tokenId: identity.tokenId ?? topLevelIdentity.tokenId,
      agentId: identity.agentId ?? topLevelIdentity.agentId,
      customerId: identity.customerId ?? topLevelIdentity.customerId,
    });

    return {
      valid,
      scopes: stringArrayAt(response, "scopes"),
      identity: normalizedIdentity,
      tokenId: normalizedIdentity.tokenId,
      agentId: normalizedIdentity.agentId,
      customerId: normalizedIdentity.customerId,
      expiresAt: nullableStringAt(response, "expires_at") ?? undefined,
    };
  }

  async listTokens(request: ListTokensRequest): Promise<ListTokensResponse> {
    requireString(request.mcpId, "mcpId");
    const query = request.includeRevoked ? "?include_revoked=true" : "";
    const response = await this.request<Record<string, unknown>>(
      `/hosted-mcps/${encodeURIComponent(request.mcpId)}/tokens${query}`,
      { method: "GET" },
    );
    const tokensValue = response["tokens"];
    const tokens = Array.isArray(tokensValue) ? tokensValue.map(normalizeTokenMetadata).filter(Boolean) as TokenMetadata[] : [];
    return { tokens };
  }

  async revokeToken(request: RevokeTokenRequest): Promise<RevokeTokenResponse> {
    requireString(request.mcpId, "mcpId");
    requireString(request.tokenId, "tokenId");
    const response = await this.request<Record<string, unknown>>(
      `/hosted-mcps/${encodeURIComponent(request.mcpId)}/tokens/${encodeURIComponent(request.tokenId)}`,
      { method: "DELETE" },
    );
    return {
      revoked: typeof response["revoked"] === "boolean" ? response["revoked"] : true,
      tokenId: stringAt(response, "token_id") || stringAt(response, "tokenId") || request.tokenId,
    };
  }

  async rotateToken(request: RotateTokenRequest): Promise<RotateTokenResponse> {
    requireString(request.tokenId, "tokenId");
    const newToken = await this.createToken({
      ...request,
      request: {
        ...request.request,
        idempotencyKey: request.request?.idempotencyKey ?? randomUUID(),
      },
    });
    const revoked = await this.revokeToken({
      mcpId: request.mcpId,
      tokenId: request.tokenId,
    });
    return { newToken, revoked };
  }

  async audit(event: AuditEvent): Promise<AuditLogResponse> {
    requireString(event.action, "action");
    const response = await this.request<Record<string, unknown>>("/audit/events", {
      method: "POST",
      body: omitUndefined({
        agent_id: event.agentId,
        customer_id: event.customerId,
        action: event.action,
        resource: event.resource,
        outcome: event.outcome,
        metadata: event.metadata,
      }),
      request: event.request,
    });
    return {
      id: stringAt(response, "id"),
      createdAt: stringAt(response, "created_at") || stringAt(response, "createdAt"),
    };
  }

  dashboardUrl(path = "/dashboard"): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${this.appUrl}${normalizedPath}`;
  }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      body?: unknown;
      request?: RequestOptions;
    },
  ): Promise<T> {
    const requestId = randomUUID();
    const retry = normalizeRetry({ ...this.retry, ...options.request?.retry });
    const timeoutMs = options.request?.timeoutMs ?? this.timeoutMs;
    const idempotencyKey = options.request?.idempotencyKey;
    const maxAttempts = retry.retries + 1;
    const canRetryUnsafe = retry.retryUnsafe || Boolean(idempotencyKey);
    const url = `${this.apiUrl}${path}`;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const hookEvent = { method: options.method, url, path, requestId, attempt, idempotencyKey };

      const init: RequestInit = {
        method: options.method,
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "preman-sdk",
          "X-Request-Id": requestId,
          ...options.request?.headers,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
      };
      if (options.body !== undefined) {
        init.body = JSON.stringify(options.body);
      }

      try {
        await this.hooks?.onRequest?.(hookEvent);
        const response = await this.fetchImpl(url, init);
        clearTimeout(timeout);
        const durationMs = Date.now() - startedAt;
        await this.hooks?.onResponse?.({ ...hookEvent, status: response.status, durationMs });

        if (response.ok) {
          const text = await response.text();
          if (!text) return {} as T;
          return JSON.parse(text) as T;
        }

        const body = await readBody(response);
        const error = errorFromResponse(response, body);
        if (shouldRetryResponse(response.status, options.method, canRetryUnsafe) && attempt < maxAttempts) {
          await this.hooks?.onError?.({ ...hookEvent, status: response.status, durationMs, error });
          await sleep(backoffMs(attempt, retry));
          continue;
        }

        throw error;
      } catch (error) {
        clearTimeout(timeout);
        const durationMs = Date.now() - startedAt;
        await this.hooks?.onError?.({ ...hookEvent, status: error instanceof PremanError ? error.status : undefined, durationMs, error });
        if (attempt < maxAttempts && shouldRetryError(error, options.method, canRetryUnsafe)) {
          await sleep(backoffMs(attempt, retry));
          continue;
        }
        throw error;
      }
    }
    throw new PremanError("PreMan API request failed after retry attempts.");
  }
}

function normalizeRetry(retry: RetryOptions | undefined = {}): Required<RetryOptions> {
  return {
    retries: retry.retries ?? 2,
    initialDelayMs: retry.initialDelayMs ?? 250,
    maxDelayMs: retry.maxDelayMs ?? 2_000,
    retryUnsafe: retry.retryUnsafe ?? false,
  };
}

function shouldRetryResponse(status: number, method: string, canRetryUnsafe: boolean): boolean {
  if (![408, 429, 500, 502, 503, 504].includes(status)) return false;
  return method === "GET" || method === "DELETE" || canRetryUnsafe;
}

function shouldRetryError(error: unknown, method: string, canRetryUnsafe: boolean): boolean {
  if (error instanceof PremanAuthError || error instanceof PremanPolicyDeniedError) return false;
  if (error instanceof PremanError && error.status && !shouldRetryResponse(error.status, method, canRetryUnsafe)) return false;
  return method === "GET" || method === "DELETE" || canRetryUnsafe;
}

function backoffMs(attempt: number, retry: Required<RetryOptions>): number {
  const raw = retry.initialDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(raw, retry.maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorFromResponse(response: Response, body: unknown): PremanError {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const rawMessage = extractErrorMessage(body) ?? `PreMan API request failed with ${response.status}`;
  const message = response.status === 401 || response.status === 403 ? enhanceAuthMessage(rawMessage) : rawMessage;

  if (response.status === 401 || response.status === 403) {
    if (message.toLowerCase().includes("policy")) {
      return new PremanPolicyDeniedError(message, { status: response.status, requestId, body });
    }
    return new PremanAuthError(message, { status: response.status, requestId, body });
  }

  return new PremanError(message, { status: response.status, requestId, body });
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PremanConfigError(`${field} is required.`);
  }
}

function requireNonEmptyArray<T>(value: T[] | undefined, field: string): asserts value is T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PremanConfigError(`${field} must be a non-empty array.`);
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const detail = record["detail"];
  const error = record["error"];
  if (typeof detail === "string") return detail;
  if (typeof error === "string") return error;
  return undefined;
}

function enhanceAuthMessage(message: string): string {
  if (/invalid auth token|invalid or revoked api key|invalid api key/i.test(message)) {
    return `${message}. Use a PreMan workspace API key that starts with pm_live_. Create or copy one at https://app.preman.live/settings, then run \`preman init --api-key pm_live_...\`.`;
  }
  return message;
}

function toBackendEndpoint(endpoint: import("./types.js").EndpointDefinition): Record<string, unknown> {
  const pathTemplate = endpoint.path_template ?? endpoint.pathTemplate ?? endpoint.path ?? "/";
  return omitUndefined({
    method: endpoint.method.toUpperCase(),
    path_template: pathTemplate,
    base_url: endpoint.base_url ?? endpoint.baseUrl,
    description: endpoint.description,
    tags: endpoint.tags,
    request_body_schema: endpoint.request_body_schema ?? endpoint.requestBodySchema,
    response_schema: endpoint.response_schema ?? endpoint.responseSchema,
    headers_schema: endpoint.headers_schema ?? endpoint.headersSchema,
    query_schema: endpoint.query_schema ?? endpoint.querySchema,
    scope: endpoint.scope,
  });
}

function objectAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const item = value[key];
  return item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
}

function stringAt(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  return typeof item === "string" ? item : "";
}

function nullableStringAt(value: Record<string, unknown>, key: string): string | null {
  const item = value[key];
  return typeof item === "string" ? item : null;
}

function numberAt(value: Record<string, unknown>, key: string): number {
  const item = value[key];
  return typeof item === "number" ? item : 0;
}

function stringArrayAt(value: Record<string, unknown>, key: string): string[] {
  const item = value[key];
  return Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string") : [];
}

function arrayOfObjectsAt(value: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const item = value[key];
  return Array.isArray(item)
    ? item.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function normalizeVerifyTokenIdentity(value: Record<string, unknown>): {
  tokenId?: string;
  agentId?: string;
  customerId?: string;
} {
  return omitUndefined({
    tokenId: stringAt(value, "token_id") || stringAt(value, "tokenId") || undefined,
    agentId: stringAt(value, "agent_id") || stringAt(value, "agentId") || undefined,
    customerId: stringAt(value, "customer_id") || stringAt(value, "customerId") || undefined,
  });
}

function normalizeInstallSnippet(value: Record<string, unknown>): HostedMcpInstallSnippet {
  const mcpJson = objectAt(value, "mcp_json");
  return {
    ...(value as Record<string, unknown>),
    url: stringAt(value, "url"),
    serverName: stringAt(value, "server_name") || undefined,
    authorizationHeader: stringAt(value, "authorization_header") || undefined,
    mcp_json: mcpJson,
    mcpJson,
    mcp_json_string: stringAt(value, "mcp_json_string") || undefined,
    mcpJsonString: stringAt(value, "mcp_json_string") || undefined,
    installText: stringAt(value, "install_text") || undefined,
  } as HostedMcpInstallSnippet;
}

function normalizeHostedMcpImport(response: Record<string, unknown>, appUrl: string): HostedMcpImportResponse {
  const hosted = objectAt(response, "hosted_mcp") as HostedMcpRecord;
  const installSnippet = objectAt(response, "install_snippet");
  const mcpId = stringAt(hosted, "id");
  const name = stringAt(hosted, "name");
  const hostedUrl = nullableStringAt(response, "hosted_mcp_url");
  return {
    mcpId: mcpId || undefined,
    name: name || undefined,
    hostedUrl,
    dashboardUrl: mcpId ? `${appUrl}/hosted-mcps/${encodeURIComponent(mcpId)}` : undefined,
    hostedMcp: Object.keys(hosted).length ? hosted : null,
    initialCredential: objectOrNullAt(response, "initial_credential"),
    installSnippet: Object.keys(installSnippet).length ? normalizeInstallSnippet(installSnippet) : null,
    preview: objectOrUndefinedAt(response, "preview"),
    generatedSpec: objectOrUndefinedAt(response, "generated_spec"),
    notice: stringAt(response, "notice") || undefined,
    raw: response,
  };
}

function normalizeLocalStdioTunnel(response: Record<string, unknown>, appUrl: string): LocalStdioTunnelResponse {
  const tunnel = objectAt(response, "tunnel");
  const hosted = objectAt(response, "hosted_mcp") as HostedMcpRecord;
  const installSnippet = objectAt(response, "install_snippet");
  const tunnelId = stringAt(response, "tunnel_id") || stringAt(tunnel, "id") || stringAt(tunnel, "tunnel_id");
  const mcpId = stringAt(response, "mcp_id") || stringAt(hosted, "id") || stringAt(tunnel, "mcp_id");
  return {
    tunnelId,
    mcpId: mcpId || undefined,
    name: stringAt(response, "name") || stringAt(hosted, "name") || stringAt(tunnel, "name") || undefined,
    status: stringAt(response, "status") || stringAt(tunnel, "status") || undefined,
    connectorUrl: nullableStringAt(response, "connector_url") ?? nullableStringAt(tunnel, "connector_url"),
    hostedUrl: nullableStringAt(response, "hosted_mcp_url") ?? nullableStringAt(tunnel, "hosted_mcp_url"),
    dashboardUrl: mcpId ? `${appUrl}/hosted-mcps/${encodeURIComponent(mcpId)}` : undefined,
    localStdio: normalizeLocalStdioCommand(objectAt(response, "local_stdio")),
    installSnippet: Object.keys(installSnippet).length ? normalizeInstallSnippet(installSnippet) : null,
    raw: response,
  };
}

function normalizeLocalStdioCommand(value: Record<string, unknown>) {
  const command = stringAt(value, "command");
  if (!command) return undefined;
  const args = stringArrayAt(value, "args");
  const envNames = stringArrayAt(value, "env_names").length ? stringArrayAt(value, "env_names") : stringArrayAt(value, "envNames");
  return omitUndefined({
    command,
    args: args.length ? args : undefined,
    cwd: stringAt(value, "cwd") || undefined,
    envNames: envNames.length ? envNames : undefined,
    env_names: envNames.length ? envNames : undefined,
  });
}

function normalizeLocalStdioTunnelMessage(value: Record<string, unknown>) {
  const message = objectAt(value, "message");
  return {
    id: stringAt(value, "id") || stringAt(value, "message_id") || undefined,
    message,
    receivedAt: stringAt(value, "received_at") || stringAt(value, "receivedAt") || undefined,
    raw: value,
  };
}

function normalizeTokenMetadata(value: unknown): TokenMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = stringAt(record, "id") || stringAt(record, "token_id") || stringAt(record, "tokenId");
  if (!id) return undefined;
  return {
    id,
    consumerLabel: stringAt(record, "consumer_label") || stringAt(record, "consumerLabel") || undefined,
    scopes: stringArrayAt(record, "scopes"),
    expiresAt: nullableStringAt(record, "expires_at") ?? nullableStringAt(record, "expiresAt"),
    revokedAt: nullableStringAt(record, "revoked_at") ?? nullableStringAt(record, "revokedAt"),
    createdAt: nullableStringAt(record, "created_at") ?? nullableStringAt(record, "createdAt"),
    raw: record,
  };
}

function objectOrNullAt(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const item = objectAt(value, key);
  return Object.keys(item).length ? item : null;
}

function objectOrUndefinedAt(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const item = objectAt(value, key);
  return Object.keys(item).length ? item : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
