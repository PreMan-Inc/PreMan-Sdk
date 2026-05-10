import {
  type AuditEvent,
  type AuditLogResponse,
  type CreateTokenRequest,
  type CreateTokenResponse,
  type DeployMcpRequest,
  type DeployMcpResponse,
  type PremanClientOptions,
  type RegisterEndpointsRequest,
  type RegisterEndpointsResponse,
  type VerifyTokenRequest,
  type VerifyTokenResponse,
} from "./types.js";
import { PremanAuthError, PremanConfigError, PremanError, PremanPolicyDeniedError } from "./errors.js";

const DEFAULT_API_URL = "https://flow.opentest.live";
const DEFAULT_APP_URL = "https://www.flowtest.opentest.live";

export class PremanClient {
  readonly apiUrl: string;
  readonly appUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PremanClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env["PREMAN_API_KEY"] ?? "";
    if (!apiKey.trim()) {
      throw new PremanConfigError("Missing PREMAN_API_KEY. Pass apiKey or set PREMAN_API_KEY.");
    }

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new PremanConfigError("No fetch implementation available. Use Node >=18 or pass fetchImpl.");
    }

    this.apiKey = apiKey;
    this.apiUrl = stripTrailingSlash(options.apiUrl ?? process.env["PREMAN_API_URL"] ?? DEFAULT_API_URL);
    this.appUrl = stripTrailingSlash(options.appUrl ?? process.env["PREMAN_APP_URL"] ?? DEFAULT_APP_URL);
    this.fetchImpl = fetchImpl;
  }

  async registerEndpoints(request: RegisterEndpointsRequest): Promise<RegisterEndpointsResponse> {
    requireNonEmptyArray(request.endpoints, "endpoints");
    return this.request<RegisterEndpointsResponse>("/v1/endpoints/register", {
      method: "POST",
      body: request,
    });
  }

  async deployMcp(request: DeployMcpRequest): Promise<DeployMcpResponse> {
    requireString(request.name, "name");
    requireString(request.upstreamBaseUrl, "upstreamBaseUrl");
    if (!request.endpointIds?.length && !request.endpoints?.length) {
      throw new PremanConfigError("deployMcp requires endpointIds or endpoints.");
    }
    return this.request<DeployMcpResponse>("/v1/mcps/deploy", {
      method: "POST",
      body: request,
    });
  }

  async createToken(request: CreateTokenRequest): Promise<CreateTokenResponse> {
    requireString(request.mcpId, "mcpId");
    requireNonEmptyArray(request.scopes, "scopes");
    return this.request<CreateTokenResponse>("/v1/tokens", {
      method: "POST",
      body: request,
    });
  }

  async verifyToken(request: VerifyTokenRequest): Promise<VerifyTokenResponse> {
    requireString(request.token, "token");
    return this.request<VerifyTokenResponse>("/v1/tokens/verify", {
      method: "POST",
      body: request,
    });
  }

  async audit(event: AuditEvent): Promise<AuditLogResponse> {
    requireString(event.action, "action");
    return this.request<AuditLogResponse>("/v1/audit/events", {
      method: "POST",
      body: event,
    });
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
    },
  ): Promise<T> {
    const init: RequestInit = {
      method: options.method,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "@preman/sdk",
      },
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(`${this.apiUrl}${path}`, init);

    if (response.ok) {
      return response.json() as Promise<T>;
    }

    const requestId = response.headers.get("x-request-id") ?? undefined;
    const body = await readBody(response);
    const message = extractErrorMessage(body) ?? `PreMan API request failed with ${response.status}`;

    if (response.status === 401 || response.status === 403) {
      if (message.toLowerCase().includes("policy")) {
        throw new PremanPolicyDeniedError(message, { status: response.status, requestId, body });
      }
      throw new PremanAuthError(message, { status: response.status, requestId, body });
    }

    throw new PremanError(message, { status: response.status, requestId, body });
  }
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
