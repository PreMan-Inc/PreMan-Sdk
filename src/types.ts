export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type JsonSchema = Record<string, unknown>;

export type EndpointDefinition = {
  method: HttpMethod;
  path?: string;
  pathTemplate?: string;
  path_template?: string;
  baseUrl?: string;
  base_url?: string;
  description?: string;
  tags?: string[];
  scope?: string;
  requestBodySchema?: JsonSchema;
  request_body_schema?: JsonSchema;
  responseSchema?: JsonSchema;
  response_schema?: JsonSchema;
  headersSchema?: JsonSchema;
  headers_schema?: JsonSchema;
  querySchema?: JsonSchema;
  query_schema?: JsonSchema;
};

export type RegisterEndpointsRequest = {
  sessionId?: string;
  projectId?: string;
  upstreamBaseUrl?: string;
  endpoints: EndpointDefinition[];
  intent?: string;
  request?: RequestOptions;
};

export type RegisterEndpointsResponse = {
  sessionId: string;
  endpointCount: number;
  dashboardUrl: string;
  endpointsUrl: string;
};

export type DeployMcpRequest = {
  name: string;
  upstreamBaseUrl: string;
  sessionId?: string;
  endpoints?: EndpointDefinition[];
  scopes?: string[];
  initialUpstreamSecret?: string;
  initialUpstreamSecretType?: "bearer" | "api_key" | "basic" | "custom";
  upstreamAuthStyle?: Record<string, unknown>;
  initialConsumerLabel?: string | null;
  request?: RequestOptions;
};

export type DeployMcpResponse = {
  mcpId: string;
  name: string;
  hostedUrl: string;
  dashboardUrl: string;
  toolCount: number;
  rawConsumerToken?: string | null;
  consumerToken?: Record<string, unknown> | null;
  installSnippet?: HostedMcpInstallSnippet | null;
};

export type HostedMcpAccessMode = "public" | "token";

export type UpstreamSecretType = "bearer" | "api_key" | "basic" | "custom";

export type UpstreamAuthStyle = {
  type?: "header" | "query" | "basic";
  name?: string;
  prefix?: string;
};

export type HostedMcpRecord = Record<string, unknown> & {
  id?: string;
  name?: string;
  upstream_base_url?: string;
  access_mode?: HostedMcpAccessMode;
  status?: string;
  endpoint_selection?: unknown;
};

export type HostedMcpTool = {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
  input_schema?: JsonSchema;
  _endpoint_ref?: Record<string, unknown>;
};

export type HostedMcpCatalog = {
  mcpId?: string;
  name?: string;
  upstreamBaseUrl?: string;
  tools: HostedMcpTool[];
  raw?: Record<string, unknown>;
};

export type GetHostedMcpCatalogResponse = {
  catalog: HostedMcpCatalog;
  raw: Record<string, unknown>;
};

export type ListHostedMcpsResponse = {
  hostedMcps: HostedMcpRecord[];
  total: number;
  raw: Record<string, unknown>;
};

export type GetHostedMcpResponse = {
  hostedMcp: HostedMcpRecord;
  raw: Record<string, unknown>;
};

export type ImportFromDocsRequest = {
  docsUrl: string;
  name?: string;
  slug?: string;
  upstreamBaseUrl?: string;
  upstreamAuthStyle?: UpstreamAuthStyle;
  initialUpstreamSecret?: string;
  initialUpstreamSecretType?: UpstreamSecretType;
  accessMode?: HostedMcpAccessMode;
  maxEndpoints?: number;
  deploy?: boolean;
  request?: RequestOptions;
};

export type ImportRemoteMcpRequest = {
  mcpUrl: string;
  name?: string;
  slug?: string;
  upstreamAuthStyle?: UpstreamAuthStyle;
  initialUpstreamSecret?: string;
  initialUpstreamSecretType?: UpstreamSecretType;
  accessMode?: HostedMcpAccessMode;
  request?: RequestOptions;
};

export type LocalStdioCommand = {
  command: string;
  args?: string[];
  cwd?: string;
  envNames?: string[];
  env_names?: string[];
};

export type CreateLocalStdioTunnelRequest = {
  name: string;
  slug?: string;
  command: string;
  args?: string[];
  cwd?: string;
  envNames?: string[];
  accessMode?: HostedMcpAccessMode;
  scopes?: string[];
  request?: RequestOptions;
};

export type LocalStdioTunnelMessage = {
  id?: string;
  message: Record<string, unknown>;
  receivedAt?: string;
  raw?: Record<string, unknown>;
};

export type LocalStdioTunnelPollRequest = {
  tunnelId: string;
  waitMs?: number;
  request?: RequestOptions;
};

export type LocalStdioTunnelPollResponse = {
  messages: LocalStdioTunnelMessage[];
  raw: Record<string, unknown>;
};

export type SendLocalStdioTunnelMessageRequest = {
  tunnelId: string;
  message: Record<string, unknown>;
  request?: RequestOptions;
};

export type UpdateLocalStdioTunnelStatusRequest = {
  tunnelId: string;
  status: "starting" | "connected" | "error" | "closed";
  detail?: string;
  request?: RequestOptions;
};

export type LocalStdioTunnelResponse = {
  tunnelId: string;
  mcpId?: string;
  name?: string;
  status?: string;
  connectorUrl?: string | null;
  hostedUrl?: string | null;
  dashboardUrl?: string;
  localStdio?: LocalStdioCommand;
  installSnippet?: HostedMcpInstallSnippet | null;
  raw: Record<string, unknown>;
};

export type HostedMcpImportResponse = {
  mcpId?: string;
  name?: string;
  hostedUrl?: string | null;
  dashboardUrl?: string;
  hostedMcp?: HostedMcpRecord | null;
  initialCredential?: Record<string, unknown> | null;
  installSnippet?: HostedMcpInstallSnippet | null;
  preview?: Record<string, unknown>;
  generatedSpec?: Record<string, unknown>;
  notice?: string;
  raw: Record<string, unknown>;
};

export type CreateTokenRequest = {
  mcpId: string;
  agentId?: string;
  customerId?: string;
  label?: string;
  consumerLabel?: string;
  scopes: string[];
  ttlSeconds?: number;
  maxToolCalls?: number;
  rateLimitRpm?: number;
  upstreamCredentialId?: string | null;
  request?: RequestOptions;
};

export type CreateTokenResponse = {
  token: string;
  tokenId: string;
  expiresAt?: string | null;
  metadata: Record<string, unknown>;
  installSnippet: HostedMcpInstallSnippet;
};

export type TokenMetadata = {
  id: string;
  consumerLabel?: string;
  scopes: string[];
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt?: string | null;
  raw?: Record<string, unknown>;
};

export type ListTokensRequest = {
  mcpId: string;
  includeRevoked?: boolean;
};

export type ListTokensResponse = {
  tokens: TokenMetadata[];
};

export type RevokeTokenRequest = {
  mcpId: string;
  tokenId: string;
};

export type RevokeTokenResponse = {
  revoked: boolean;
  tokenId: string;
};

export type RotateTokenRequest = CreateTokenRequest & {
  tokenId: string;
};

export type RotateTokenResponse = {
  newToken: CreateTokenResponse;
  revoked: RevokeTokenResponse;
};

export type HostedMcpInstallSnippet = {
  url: string;
  server_name?: string;
  serverName?: string;
  authorization_header?: string;
  authorizationHeader?: string;
  mcp_json: Record<string, unknown>;
  mcpJson: Record<string, unknown>;
  mcp_json_string?: string;
  mcpJsonString?: string;
  install_text?: string;
  installText?: string;
};

export type AuditEvent = {
  agentId?: string;
  customerId?: string;
  action: string;
  resource?: string;
  outcome?: "success" | "error" | "denied";
  metadata?: Record<string, unknown>;
  request?: RequestOptions;
};

export type AuditLogResponse = {
  id: string;
  createdAt: string;
};

export type VerifyTokenRequest = {
  token: string;
  mcpId: string;
  requiredScope?: string;
  request?: RequestOptions;
};

export type VerifyTokenIdentity = {
  tokenId?: string;
  agentId?: string;
  customerId?: string;
};

export type VerifyTokenResponse = {
  valid: boolean;
  scopes: string[];
  identity: VerifyTokenIdentity;
  tokenId?: string;
  agentId?: string;
  customerId?: string;
  expiresAt?: string;
};

export type PremanClientOptions = {
  apiKey?: string;
  apiUrl?: string;
  appUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retry?: RetryOptions;
  hooks?: PremanClientHooks;
};

export type RetryOptions = {
  retries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  retryUnsafe?: boolean;
};

export type RequestOptions = {
  timeoutMs?: number;
  idempotencyKey?: string;
  retry?: RetryOptions;
  headers?: Record<string, string>;
};

export type RequestHookEvent = {
  method: string;
  url: string;
  path: string;
  requestId: string;
  attempt: number;
  idempotencyKey?: string;
};

export type ResponseHookEvent = RequestHookEvent & {
  status: number;
  durationMs: number;
};

export type ErrorHookEvent = RequestHookEvent & {
  status?: number;
  durationMs: number;
  error: unknown;
};

export type PremanClientHooks = {
  onRequest?: (event: RequestHookEvent) => void | Promise<void>;
  onResponse?: (event: ResponseHookEvent) => void | Promise<void>;
  onError?: (event: ErrorHookEvent) => void | Promise<void>;
};
