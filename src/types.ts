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
};

export type CreateTokenResponse = {
  token: string;
  tokenId: string;
  expiresAt?: string | null;
  metadata: Record<string, unknown>;
  installSnippet: HostedMcpInstallSnippet;
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
};

export type AuditLogResponse = {
  id: string;
  createdAt: string;
};

export type VerifyTokenRequest = {
  token: string;
  mcpId: string;
  requiredScope?: string;
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
};
