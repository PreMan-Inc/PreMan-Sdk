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

/** Standing authorization for scheduled requests against an endpoint. */
export type UnattendedPolicy = "read_only" | "allow_writes" | "allow_destructive";

export type ConfigureEndpointProbeRequest = {
  endpointId: string;
  enabled?: boolean;
  /** Probe cadence in seconds (30..3600, default 60). */
  intervalSeconds?: number;
  /** Per-request timeout in seconds (0..30, default 10). */
  timeoutSeconds?: number;
  /** Exact expected status. When omitted, any status below 400 passes. */
  expectedStatus?: number | null;
  /** Target API headers. Values are encrypted by PreMan and never returned. */
  headers?: Record<string, string> | null;
  unattendedPolicy?: UnattendedPolicy;
  request?: RequestOptions;
};

export type EndpointProbe = {
  id: string;
  endpointId: string;
  enabled: boolean;
  intervalSeconds: number;
  timeoutSeconds: number;
  expectedStatus?: number | null;
  headerKeys: string[];
  hasCustomHeaders: boolean;
  nextDueAt?: string | null;
  lastRunAt?: string | null;
  method?: HttpMethod;
  pathTemplate?: string;
  baseUrl?: string;
  raw: Record<string, unknown>;
};

export type ProbeResult = {
  timestamp: string;
  ok: boolean;
  responseStatus?: number | null;
  latencyMs?: number | null;
  error?: string | null;
  raw: Record<string, unknown>;
};

export type ListProbeResultsRequest = {
  endpointId: string;
  limit?: number;
  request?: RequestOptions;
};

export type AlertRuleType = "consecutive_failures" | "error_rate";
export type AlertTargetKind = "endpoint" | "hosted_mcp" | "auto_test_suite" | "project_logs";

export type CreateHealingRuleRequest = {
  name?: string;
  targetKind?: AlertTargetKind;
  targetId: string;
  ruleType?: AlertRuleType;
  thresholdFailures?: number;
  errorRateThreshold?: number;
  windowMinutes?: number;
  minSamples?: number;
  channelIds?: string[];
  enabled?: boolean;
  /** Queue PreMan's native repair engine automatically when this rule fires. */
  autofixEnabled?: boolean;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  request?: RequestOptions;
};

export type HealingRule = {
  id: string;
  name: string;
  targetKind: AlertTargetKind;
  targetId: string;
  ruleType: AlertRuleType;
  thresholdFailures?: number | null;
  errorRateThreshold?: number | null;
  windowMinutes?: number | null;
  minSamples: number;
  channelIds: string[];
  enabled: boolean;
  autofixEnabled: boolean;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  lastEvaluatedAt?: string | null;
  createdAt?: string | null;
  raw: Record<string, unknown>;
};

export type EndpointIncident = {
  id: string;
  ruleId: string;
  firedAt?: string | null;
  resolvedAt?: string | null;
  trigger: Record<string, unknown>;
  deliveries: Array<Record<string, unknown>>;
  resolutionDeliveries: Array<Record<string, unknown>>;
  deliveryPending: boolean;
  raw: Record<string, unknown>;
};

export type ListIncidentsRequest = {
  ruleId?: string;
  limit?: number;
  request?: RequestOptions;
};

export type FixTaskStatus = "open" | "delivered" | "resolved";
export type SelfHealingStage =
  | "queued"
  | "cloning"
  | "patching"
  | "validating"
  | "pushing"
  | "opening_pr"
  | "done"
  | "failed"
  | string;

export type FixTask = {
  id: string;
  workspaceId?: string | null;
  sourceKind: string;
  sourceId: string;
  status: FixTaskStatus;
  package: Record<string, unknown>;
  githubIssueUrl?: string | null;
  jiraIssueUrl?: string | null;
  prUrl?: string | null;
  executor?: string | null;
  dispatchProvider?: string | null;
  dispatchRunId?: string | null;
  dispatchRunUrl?: string | null;
  dispatchStatus?: string | null;
  dispatchStage?: SelfHealingStage | null;
  dispatchResult?: unknown;
  dispatchAttempts: number;
  dispatchedAt?: string | null;
  deliveredAt?: string | null;
  resolvedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  raw: Record<string, unknown>;
};

export type ListFixTasksRequest = {
  status?: FixTaskStatus;
  limit?: number;
  request?: RequestOptions;
};

export type StartSelfHealingRequest = {
  fixTaskId: string;
  request?: RequestOptions;
};

export type StartSelfHealingResponse = {
  fixTaskId: string;
  dispatch: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export type WaitForSelfHealingRequest = {
  fixTaskId: string;
  /** Poll interval in milliseconds (default 3000). */
  pollIntervalMs?: number;
  /** Maximum wait in milliseconds (default 300000). */
  timeoutMs?: number;
  request?: RequestOptions;
};

/** Who runs the HTTP API that implements tool endpoints. */
export type UpstreamMode = "external" | "preman";

/** Lifecycle for a PreMan-provisioned upstream workload. */
export type UpstreamHostingRuntimeStatus =
  | "pending"
  | "building"
  | "running"
  | "failed"
  | "stopped"
  | "unknown";

export type UpstreamBuildConfig = {
  /** Pre-built OCI image reference, e.g. ghcr.io/org/spotify-mcp:1.0.0 */
  image?: string;
  /** Dockerfile path relative to build context, default Dockerfile */
  dockerfile?: string;
  contextPath?: string;
  context_path?: string;
  /** Tarball or git archive URL for remote builds */
  buildContextUrl?: string;
  build_context_url?: string;
  port?: number;
  healthPath?: string;
  health_path?: string;
  env?: Record<string, string>;
  secretNames?: string[];
  secret_names?: string[];
};

export type UpstreamHostingCapabilities = {
  featureId: string;
  supported: boolean;
  modes: UpstreamMode[];
  defaultMode: UpstreamMode;
  supportsDockerfileBuild?: boolean;
  supportsImageDeploy?: boolean;
  supportsBuildContextUrl?: boolean;
};

export type PremanCapabilities = {
  version?: string;
  upstreamHosting: UpstreamHostingCapabilities;
  raw?: Record<string, unknown>;
};

export type GetCapabilitiesRequest = {
  request?: RequestOptions;
};

export type UpstreamHostingRecord = {
  mcpId: string;
  upstreamMode: UpstreamMode;
  status: UpstreamHostingRuntimeStatus;
  upstreamBaseUrl?: string | null;
  publicUrl?: string | null;
  buildId?: string | null;
  message?: string | null;
  raw?: Record<string, unknown>;
};

export type GetUpstreamHostingStatusRequest = {
  mcpId: string;
  request?: RequestOptions;
};

export type WaitForUpstreamHostingRequest = GetUpstreamHostingStatusRequest & {
  /** Poll interval in ms (default 3000) */
  pollIntervalMs?: number;
  /** Max wait in ms (default 300000) */
  timeoutMs?: number;
  /** Status values that resolve the wait (default: ["running"]) */
  readyStatuses?: UpstreamHostingRuntimeStatus[];
};

export type DeployMcpRequest = {
  name: string;
  /**
   * Required when upstreamMode is "external" (default).
   * Ignored when upstreamMode is "preman" unless the API accepts an override.
   */
  upstreamBaseUrl?: string;
  /** Default "external". Use "preman" to have PreMan host the upstream API. */
  upstreamMode?: UpstreamMode;
  /** Required when upstreamMode is "preman". */
  upstreamBuild?: UpstreamBuildConfig;
  sessionId?: string;
  endpoints?: EndpointDefinition[];
  scopes?: string[];
  initialUpstreamSecret?: string;
  initialUpstreamSecretType?: "bearer" | "api_key" | "basic" | "custom";
  upstreamAuthStyle?: UpstreamAuthStyle;
  initialConsumerLabel?: string | null;
  upstreamOAuthProvider?: UpstreamOAuthProviderConfig;
  accessMode?: HostedMcpAccessMode;
  request?: RequestOptions;
};

export type DeployMcpResponse = {
  mcpId: string;
  name: string;
  hostedUrl: string;
  dashboardUrl: string;
  toolCount: number;
  upstreamMode?: UpstreamMode;
  upstreamHosting?: UpstreamHostingRecord | null;
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

export type UpstreamOAuthProviderConfig = {
  provider?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string;
  clientId: string;
  clientSecret: string;
};

export type UpstreamOAuthStartResponse = {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
  provider: string;
  instructions: string;
};

export type StartUpstreamOAuthRequest = {
  mcpId: string;
  request?: RequestOptions;
};

export type StartConsumerUpstreamOAuthRequest = {
  mcpId: string;
  consumerToken: string;
  apiUrl?: string;
  request?: RequestOptions;
};

export type HostedMcpRecord = Record<string, unknown> & {
  id?: string;
  name?: string;
  llms_txt_markdown?: string;
  upstream_base_url?: string;
  upstream_mode?: UpstreamMode;
  upstream_status?: UpstreamHostingRuntimeStatus;
  upstream_oauth_provider?: Record<string, unknown> | null;
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

export type UpdateHostedMcpRequest = {
  mcpId: string;
  name?: string;
  llmsTxtMarkdown?: string;
  upstreamBaseUrl?: string;
  upstreamAuthStyle?: UpstreamAuthStyle;
  endpointSelection?: unknown;
  toolSchemaOverrides?: Record<string, unknown>;
  status?: "active" | "paused" | "archived";
  accessMode?: HostedMcpAccessMode;
  humanApprovalRequired?: boolean;
  syncCoherenceCheck?: boolean;
  verificationTier?: 1 | 2;
  request?: RequestOptions;
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

/** Access mode for App governed runtimes. */
export type AppAccessMode = "token" | "public";

export type AppPlaybookStep = {
  memberKey?: string;
  member_key?: string;
  title?: string;
  steps?: string[];
  [key: string]: unknown;
};

export type PremanAppMember = {
  id: string;
  profileId?: string;
  profile_id?: string;
  serverId?: string | null;
  server_id?: string | null;
  hostedMcpId?: string | null;
  hosted_mcp_id?: string | null;
  prefix: string;
  displayName?: string;
  display_name?: string;
  sortOrder?: number;
  sort_order?: number;
  createdAt?: string;
  created_at?: string;
};

export type PremanAppRecord = {
  id: string;
  userId?: number;
  user_id?: number;
  name: string;
  slug: string;
  status: "active" | "paused" | "archived";
  llmsTxtMarkdown?: string;
  llms_txt_markdown?: string;
  setupPlaybookJson?: AppPlaybookStep[];
  setup_playbook_json?: AppPlaybookStep[];
  templateKey?: string | null;
  template_key?: string | null;
  templateLinkedKey?: string | null;
  template_linked_key?: string | null;
  branding?: Record<string, unknown>;
  accessMode?: AppAccessMode;
  access_mode?: AppAccessMode;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  members?: PremanAppMember[];
};

export type PremanAppTemplate = {
  key: string;
  name: string;
  description?: string;
  defaultMembers?: Array<{ memberKey?: string; member_key?: string; prefix: string; title?: string }>;
  default_members?: Array<{ member_key?: string; prefix: string; title?: string }>;
};

export type AppSetupStatusMember = {
  prefix: string;
  displayName?: string;
  display_name?: string;
  healthy: boolean;
  status: string;
  reconnectHint?: string | null;
  reconnect_hint?: string | null;
  serverId?: string | null;
  server_id?: string | null;
  hostedMcpId?: string | null;
  hosted_mcp_id?: string | null;
};

export type AppSetupStatus = {
  appSlug?: string;
  app_slug?: string;
  appName?: string;
  app_name?: string;
  allMembersHealthy?: boolean;
  all_members_healthy?: boolean;
  members: AppSetupStatusMember[];
  llmsTxtUrl?: string;
  llms_txt_url?: string;
  setupPlaybook?: AppPlaybookStep[];
  setup_playbook?: AppPlaybookStep[];
};

export type CapabilityKind = "app" | "template" | "hosted_mcp";

export type DiscoveredCapability = {
  kind: CapabilityKind;
  id?: string;
  slug?: string | null;
  name: string;
  summarySnippet?: string;
  summary_snippet?: string;
  llmsTxtUrl?: string | null;
  llms_txt_url?: string | null;
  runtimeUrl?: string | null;
  runtime_url?: string | null;
  installHint?: string;
  install_hint?: string;
  templateKey?: string | null;
  template_key?: string | null;
  accessMode?: string | null;
  access_mode?: string | null;
};

export type DiscoverCapabilitiesRequest = {
  query: string;
  limit?: number;
  request?: RequestOptions;
};

export type DiscoverCapabilitiesResponse = {
  query: string;
  matches: DiscoveredCapability[];
  total: number;
  raw?: Record<string, unknown>;
};

export type ListAppsResponse = {
  apps: PremanAppRecord[];
  total: number;
  raw?: Record<string, unknown>;
};

export type ListAppTemplatesResponse = {
  templates: PremanAppTemplate[];
  total: number;
  raw?: Record<string, unknown>;
};

export type AppMemberInput = {
  serverId?: string;
  server_id?: string;
  hostedMcpId?: string;
  hosted_mcp_id?: string;
  prefix: string;
  displayName?: string;
  display_name?: string;
};

export type CreateAppRequest = {
  name: string;
  slug?: string;
  templateKey?: string;
  template_key?: string;
  members?: AppMemberInput[];
  accessMode?: AppAccessMode;
  access_mode?: AppAccessMode;
  llmsTxtMarkdown?: string;
  llms_txt_markdown?: string;
  setupPlaybookJson?: AppPlaybookStep[];
  setup_playbook_json?: AppPlaybookStep[];
  branding?: Record<string, unknown>;
  mintConsumerToken?: boolean;
  mint_consumer_token?: boolean;
  consumerLabel?: string;
  consumer_label?: string;
  request?: RequestOptions;
};

export type AppInstallSnippet = HostedMcpInstallSnippet & {
  llmsTxtUrl?: string;
  llms_txt_url?: string;
};

export type CreateAppResponse = {
  profile: PremanAppRecord;
  consumerToken?: Record<string, unknown>;
  rawToken?: string | null;
  raw_token?: string | null;
  installSnippet?: AppInstallSnippet | null;
  dashboardUrl: string;
  runtimeUrl: string;
  llmsTxtUrl: string;
  raw?: Record<string, unknown>;
};

export type GetAppResponse = {
  app: PremanAppRecord;
  raw?: Record<string, unknown>;
};

export type UpdateAppRequest = {
  slug: string;
  name?: string;
  status?: "active" | "paused" | "archived";
  llmsTxtMarkdown?: string;
  llms_txt_markdown?: string;
  setupPlaybookJson?: AppPlaybookStep[];
  setup_playbook_json?: AppPlaybookStep[];
  branding?: Record<string, unknown>;
  accessMode?: AppAccessMode;
  access_mode?: AppAccessMode;
  templateKey?: string;
  template_key?: string;
  request?: RequestOptions;
};

export type ImportMcpServerRequest = {
  config?: Record<string, unknown>;
  mcpUrl?: string;
  mcp_url?: string;
  name?: string;
  initialSecret?: string;
  initial_secret?: string;
  initialSecretType?: "bearer" | "api_key" | "basic" | "custom";
  initial_secret_type?: "bearer" | "api_key" | "basic" | "custom";
  request?: RequestOptions;
};

export type ManagedMcpServerRecord = {
  id: string;
  name: string;
  transportType?: string;
  transport_type?: string;
  status?: string;
  connectionConfig?: Record<string, unknown>;
  connection_config?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ImportMcpServerResponse = {
  server: ManagedMcpServerRecord;
  initialCredential?: Record<string, unknown> | null;
  raw?: Record<string, unknown>;
};

export type AddAppMemberRequest = {
  profileId: string;
  serverId?: string;
  server_id?: string;
  hostedMcpId?: string;
  hosted_mcp_id?: string;
  prefix: string;
  displayName?: string;
  display_name?: string;
  request?: RequestOptions;
};

export type AddAppMemberResponse = {
  profile: PremanAppRecord;
  raw?: Record<string, unknown>;
};

export type MintAppTokenRequest = {
  profileId: string;
  consumerLabel?: string;
  consumer_label?: string;
  request?: RequestOptions;
};

export type MintAppTokenResponse = {
  profileId: string;
  slug: string;
  consumerToken?: Record<string, unknown>;
  rawToken?: string | null;
  raw_token?: string | null;
  installSnippet: AppInstallSnippet;
  runtimeUrl: string;
  llmsTxtUrl: string;
  raw?: Record<string, unknown>;
};

export type CallPlatformToolRequest = {
  tool: string;
  arguments?: Record<string, unknown>;
  request?: RequestOptions;
};

export type CallPlatformToolResponse = {
  tool: string;
  result: unknown;
  raw?: unknown;
};
