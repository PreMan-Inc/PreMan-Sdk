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

/** Execute one request already saved in the Workbench. */
export type RunSavedRequest = {
  requestId: string;
  /** Optional workspace override. Omit to use the API key's default workspace. */
  workspaceId?: string;
  /** One-run approval for requests classified as destructive or billing-sensitive. */
  approveDestructive?: boolean;
};

export type WorkbenchRunStatus = "passed" | "failed" | "error";

export type WorkbenchAssertionKind =
  | "status"
  | "status_in"
  | "status_not"
  | "max_latency_ms"
  | "json_path"
  | "required_fields";

/** Server-evaluated outcome for one assertion on a saved Workbench request. */
export type WorkbenchAssertionResult = {
  kind: WorkbenchAssertionKind;
  expected: unknown;
  actual: unknown;
  passed: boolean;
  raw: Record<string, unknown>;
};

/** Normalized SDK view of the backend TestRunResult contract. */
export type WorkbenchTestRunResult = {
  id: string;
  requestId: string;
  status: WorkbenchRunStatus;
  responseStatus: number | null;
  latencyMs: number | null;
  responseBody: string | null;
  error: string | null;
  method: string;
  url: string;
  createdAt: string | null;
  assertions: WorkbenchAssertionResult[];
  classification: string | null;
  correlationId: string | null;
  pulseRunId: string | null;
  raw: Record<string, unknown>;
};

/** Named windows supported by the project-scoped Pulse API. */
export type EndpointHealthWindow = "1h" | "24h" | "7d" | "30d";
export type EndpointHealthStatus = "passed" | "failed" | "error" | "skipped";
export type EndpointHealthOrigin = "hosted" | "local";
export type EndpointHealthSort = "p95_ms" | "error_rate" | "runs" | "last_run_at";

export type EndpointHealthQuery = {
  projectId: string;
  window?: EndpointHealthWindow;
  start?: string | Date;
  end?: string | Date;
  method?: string;
  statuses?: EndpointHealthStatus[];
  origin?: EndpointHealthOrigin;
  originLabel?: string;
  environmentId?: string;
  minLatencyMs?: number;
  query?: string;
  request?: RequestOptions;
};

export type ListEndpointHealthRequest = EndpointHealthQuery & {
  sort?: EndpointHealthSort;
  limit?: number;
};

export type GetEndpointHealthMetricsRequest = EndpointHealthQuery & {
  endpointKey?: string;
};

export type EndpointHealthAggregate = {
  endpointKey: string;
  method: string;
  host: string;
  pathTemplate: string;
  runs: number;
  failures: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  lastRunAt: string | null;
};

export type EndpointProbeObservation = {
  method: string;
  pathTemplate: string;
  lastOk: boolean | null;
  lastProbeAt: string | null;
};

export type EndpointLogObservation = {
  method: string;
  pathTemplate: string;
  lines: number;
  errorLines: number;
  lastObservedAt: string | null;
};

export type EndpointHealthObservations = {
  probes: EndpointProbeObservation[];
  logs: EndpointLogObservation[];
};

export type ListEndpointHealthResponse = {
  projectId: string;
  window: EndpointHealthWindow | "custom";
  start: string;
  end: string;
  sort: EndpointHealthSort;
  endpoints: EndpointHealthAggregate[];
  observations: EndpointHealthObservations;
  raw?: Record<string, unknown>;
};

export type EndpointHealthSparklinePoint = {
  timestamp: string;
  runs: number;
  failures: number;
  p50Ms: number;
  p95Ms: number;
};

export type EndpointHealthMetricsResponse = {
  projectId: string;
  window: EndpointHealthWindow | "custom";
  start: string;
  end: string;
  bucketSeconds: number;
  total: number;
  failed: number;
  errored: number;
  errorRate: number;
  passRate: number | null;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  averageMs: number;
  maxMs: number;
  lastRunAt: string | null;
  sparkline: EndpointHealthSparklinePoint[];
  raw?: Record<string, unknown>;
};

export type EndpointDependencyType = "calls" | "depends_on" | "sequence_next";
export type EndpointDependencyNode = {
  id: string;
  name: string;
  method: string;
  host: string;
  pathTemplate: string;
};
export type EndpointDependencyEdge = {
  id: string;
  source: EndpointDependencyNode;
  target: EndpointDependencyNode;
  edgeType: EndpointDependencyType;
  confidence: number;
  evidence: Record<string, unknown>;
};
export type GetEndpointDependenciesRequest = {
  projectId: string;
  request?: RequestOptions;
};
export type EndpointDependenciesResponse = {
  projectId: string;
  direction: "source_depends_on_target";
  edges: EndpointDependencyEdge[];
  sources: {
    endpointEdges: number;
    collectionDeclarations: number;
  };
  raw?: Record<string, unknown>;
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

export type FixTaskDispatchActivityState = "active" | "complete";

/** One short, safe activity line reported by a running repair agent. */
export type FixTaskDispatchActivityItem = {
  id: string;
  label: string;
  state: FixTaskDispatchActivityState;
  elapsed_ms?: number;
};

/** Camel-cased SDK view of one temporary repair activity line. */
export type FixTaskAgentActivityItem = {
  id: string;
  label: string;
  state: FixTaskDispatchActivityState;
  elapsedMs?: number;
};

/** Structured progress may include at most six temporary activity lines. */
export type FixTaskDispatchProgress = Record<string, unknown> & {
  activity?: FixTaskDispatchActivityItem[];
};

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
  /** Original server payload, retained for backward compatibility. */
  dispatchResult?: unknown;
  /** Structured progress when the server supplied an object payload. */
  dispatchProgress?: FixTaskDispatchProgress | null;
  /** Validated, bounded activity lines; empty for older task responses. */
  dispatchActivity?: FixTaskAgentActivityItem[];
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

export type WorkbenchConversationMessage = {
  id: string;
  role: string;
  content: string;
  artifacts: Record<string, unknown>[];
  provider: string | null;
  model: string | null;
  createdAt: string | null;
  raw: Record<string, unknown>;
};

/** Durable Workbench chat used by Guard investigations and coding-agent handoffs. */
export type WorkbenchConversation = {
  id: string;
  workspaceId: string;
  title: string;
  archived: boolean;
  /** True when the server reports an active repair task for this conversation. */
  taskInProgress: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  messages: WorkbenchConversationMessage[];
  raw: Record<string, unknown>;
};

export type CreateWorkbenchConversationRequest = {
  title?: string;
  workspaceId?: string;
  request?: RequestOptions;
};

export type GetWorkbenchConversationRequest = {
  conversationId: string;
  request?: RequestOptions;
};

export type SendWorkbenchMessageRequest = {
  conversationId: string;
  content: string;
  provider?: string;
  request?: RequestOptions;
};

export type WorkbenchChatTurnResponse = {
  conversation: WorkbenchConversation;
  turn: WorkbenchConversationMessage;
  raw: Record<string, unknown>;
};

export type WorkbenchChatStreamEvent =
  | { type: "status"; label: string; raw: Record<string, unknown> }
  | { type: "delta"; text: string; raw: Record<string, unknown> }
  | ({ type: "done" } & WorkbenchChatTurnResponse)
  | { type: "error"; message: string; raw: Record<string, unknown> };

export type StreamWorkbenchMessageRequest = SendWorkbenchMessageRequest & {
  onEvent?: (event: WorkbenchChatStreamEvent) => void | Promise<void>;
};

export type CodingAgentExecutionMode = "read_only" | "workspace_write";

/** Deterministic Workbench action used by Guard's Investigate with agent control. */
export type CreateCodingAgentTaskRequest = {
  title: string;
  instructions: string;
  conversationId: string;
  workspaceId?: string;
  executionMode?: CodingAgentExecutionMode;
  request?: RequestOptions;
};

export type CodingAgentTaskHandoffResponse = {
  fixTask: FixTask;
  dispatch: Record<string, unknown> | null;
  artifact: Record<string, unknown>;
  alreadyExisted: boolean;
  conversation: WorkbenchConversation | null;
  raw: Record<string, unknown>;
};

export type GithubInstallStartResponse = {
  install_url: string;
  mode?: "install" | "configure";
  installations?: GithubAppInstallationSummary[];
};

export type GithubAppInstallationSummary = {
  account_login: string;
  configure_url: string;
};

export type GithubInstallRefreshResponse = {
  installations_refreshed: number;
  repositories_connected: number;
  repositories_deactivated: number;
};

export type GithubIntegration = {
  id: string;
  repo_url: string;
  default_branch?: string | null;
  discovered_endpoint_count?: number | null;
  discovery_method?: string | null;
  last_synced_at?: string | null;
  created_at?: string | null;
  auto_pr_enabled: boolean;
  simulate_on_push: boolean;
  webhook_configured: boolean;
  webhook_url: string;
  github_installation_id?: number | null;
  credential_kind?: "pat" | "github_app" | null;
  github_account_login?: string | null;
  last_commit_sha?: string | null;
  baseline_published_at?: string | null;
  workspace_id?: string | null;
  simulation_mode?: GithubSimulationMode;
  simulation_log_connector_id?: string | null;
  simulation_observation_window_days?: GithubSimulationObservationWindowDays;
  simulation_fallback_policy?: GithubSimulationFallbackPolicy;
};

export type GithubIntegrationRemovalResponse = {
  ok: true;
  integration_id: string;
  endpoints_deactivated: number;
};

export type GithubSimulationHandoffRequest = {
  /** Connected GitHub repository integration id. */
  integrationId: string;
  /** Completed simulation run id returned by Pulse. */
  runId: string;
  /** Optional workspace override. Omit to use the caller's default workspace. */
  workspaceId?: string;
  request?: RequestOptions;
};

export type GithubSimulationHandoffConversationMessage = WorkbenchConversationMessage;

/** Durable workbench chat created for a simulation repair handoff. */
export type GithubSimulationHandoffConversation = WorkbenchConversation;

/** Safe, server-authored repair handoff for a completed GitHub simulation. */
export type GithubSimulationHandoffResponse = {
  fixTask: FixTask;
  dispatch: Record<string, unknown> | null;
  artifact: Record<string, unknown>;
  alreadyExisted: boolean;
  /** The persisted chat shown in the dashboard's Recent list. */
  conversation: GithubSimulationHandoffConversation | null;
  raw: Record<string, unknown>;
};

export type GithubCommitSummary = {
  sha: string;
  message: string;
  author_name: string | null;
  authored_at: string | null;
  html_url: string | null;
};

export type GithubCommitListResponse = {
  branch: string;
  commits: GithubCommitSummary[];
};

export type ListGithubCommitsRequest = {
  integrationId: string;
  /** Number of recent commits to return (server range: 1-25, default 8). */
  limit?: number;
  request?: RequestOptions;
};

export type GithubSimulationStatus = "queued" | "running" | "succeeded" | "failed";
export type GithubSimulationTerminalStatus = Extract<
  GithubSimulationStatus,
  "succeeded" | "failed"
>;
export type GithubSimulationTrigger = "webhook" | "manual";
export type GithubSimulationMode = "contract_synthetic" | "observed_behavior";
export type GithubSimulationEffectiveMode = GithubSimulationMode | "unavailable";
export type GithubSimulationObservationWindowDays = 7 | 14 | 30;
export type GithubSimulationFallbackPolicy = "contract_synthetic" | "require_observed";
export type GithubSimulationVerdict = "green" | "impact_detected" | "inconclusive" | "failed";

export type GithubSimulationError = {
  code: string;
  message: string;
};

export type GithubRuntimeAttestation = {
  verified: number;
  missing: number;
  mismatched: number;
};

export type GithubRuntimeScenarioKind = "probe" | "auto_test_case" | "auto_test_suite";
export type GithubRuntimeScenarioOutcome = "passed" | "failed" | "unavailable" | "error";
export type GithubRuntimeBuildAttestation = "verified" | "mismatch" | "missing" | "unverified";

export type GithubRuntimeScenarioResult = {
  id: string;
  kind: GithubRuntimeScenarioKind;
  name: string;
  scenario_type: string | null;
  method: string | null;
  path: string | null;
  outcome: GithubRuntimeScenarioOutcome;
  response_status: number | null;
  latency_ms: number | null;
  failure_reason: string | null;
  build_attestation: GithubRuntimeBuildAttestation;
};

export type GithubSimulationRuntimeEvidence = {
  planned: number;
  executed: number;
  passed: number;
  failed: number;
  unavailable: number;
  coverage_complete: boolean;
  candidate_verified: boolean;
  attestation: GithubRuntimeAttestation;
};

/** One changed leaf in the published-baseline versus candidate API contract. */
export type GithubApiContractFieldDiff = {
  field: string;
  before: unknown;
  after: unknown;
  before_present: boolean;
  after_present: boolean;
  before_truncated?: boolean;
  after_truncated?: boolean;
};

/** Endpoint-level source and field evidence produced by a GitHub simulation. */
export type GithubApiContractImpact = {
  change_type: "new" | "modified" | "removed";
  method: string;
  path: string;
  file: string | null;
  /** Added for newly computed runs; older persisted runs may not contain it. */
  contract_diff?: GithubApiContractFieldDiff[];
  contract_diff_truncated?: boolean;
};

/** Published contract revision used by a GitHub simulation run summary. */
export type GithubSimulationRunBaseline = {
  storage?: string;
  location?: string;
  commit_sha?: string | null;
  branch?: string;
  published_at?: string | null;
  endpoint_count?: number;
  fingerprint?: string;
  status?: "current" | "empty" | "identity_unavailable" | "not_published" | "missing";
};

export type GithubSimulationSummary = Record<string, unknown> & {
  verdict?: GithubSimulationVerdict;
  green?: boolean;
  commit_sha?: string;
  endpoints_scanned?: number;
  baseline_endpoints?: number;
  changes_total?: number;
  new_endpoints?: number;
  modified_endpoints?: number;
  removed_endpoints?: number;
  impact?: GithubApiContractImpact[];
  impact_truncated?: boolean;
  baseline?: GithubSimulationRunBaseline;
  runtime_target?: "configured_environment" | "verified_candidate_environment";
  runtime_coverage_complete?: boolean;
  candidate_runtime_verified?: boolean;
  runtime_attestation?: GithubRuntimeAttestation;
  evidence?: Record<string, unknown> & {
    runtime?: GithubSimulationRuntimeEvidence;
  };
  candidate?: {
    commit_sha?: string;
    source_scan_verified?: boolean;
    runtime_verified?: boolean;
    build_identity_verified?: boolean;
  };
};

export type GithubSimulationRun = {
  id: string;
  integration_id: string;
  status: GithubSimulationStatus;
  trigger: GithubSimulationTrigger;
  ref: string;
  branch: string;
  commit_sha: string;
  before_sha: string | null;
  simulation_mode: GithubSimulationMode;
  baseline_commit_sha: string | null;
  github_delivery_id: string | null;
  attempt_count: number;
  summary: GithubSimulationSummary;
  steps: Array<Record<string, unknown>>;
  error: GithubSimulationError | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type GithubSimulationDetail = GithubSimulationRun & {
  /** Safe per-request evidence; request bodies, headers, and credentials are never returned. */
  runtime_scenarios: GithubRuntimeScenarioResult[];
};

export type GithubSimulationListResponse = {
  runs: GithubSimulationRun[];
  total: number;
  limit: number;
  offset: number;
};

export type ListGithubSimulationsRequest = {
  integrationId: string;
  /** Number of runs to return (server range: 1-100, default 10). */
  limit?: number;
  /** Zero-based result offset. */
  offset?: number;
  request?: RequestOptions;
};

export type StartGithubSimulationRequest = {
  integrationId: string;
  /** Branch or ref to resolve when commitSha is omitted. */
  ref?: string;
  /** Exact 40-character Git commit SHA to simulate. */
  commitSha?: string;
  request?: RequestOptions;
};

export type GetGithubSimulationRequest = {
  integrationId: string;
  runId: string;
  request?: RequestOptions;
};

export type GithubWorkspaceSimulationIntegration = {
  id: string;
  workspace_id: string;
  repo_url: string;
};

export type GithubWorkspaceSimulationReceipt =
  | {
      integration: GithubWorkspaceSimulationIntegration;
      run: GithubSimulationRun;
    }
  | {
      integration: null;
      run: null;
    };

export type GetLatestWorkspaceGithubSimulationRequest = {
  /** Workbench workspace used to scope the signed-push receipt. */
  workspaceId: string;
  request?: RequestOptions;
};

export type GithubSimulationEvidenceSource = {
  id: string;
  name: string;
  type: "cloudwatch";
  enabled: boolean;
  healthy: boolean;
  last_success_at: string | null;
  last_observed_at: string | null;
  lines_ingested_total: number;
  interval_seconds: number;
  selected: boolean;
};

export type GithubSimulationEligibility = {
  eligible: boolean;
  reason_code: string | null;
  message: string;
  project_id: string | null;
  sources: GithubSimulationEvidenceSource[];
};

export type GithubSimulationPrivacyReceipt = {
  redacted_before_persistence: boolean;
  raw_requests_replayed: boolean;
  aggregate_only: boolean;
  k_anonymity_minimum: number | null;
  minimum_distinct_requests: number;
  anonymity_claim: "not_claimed";
  maximum_scenarios: number;
  cohort_and_journey_labels: string;
  client_versions: string;
  excluded_raw_fields: string[];
};

export type GithubSimulationBaseline = {
  storage: "endpoint_definitions";
  location: string;
  commit_sha: string | null;
  branch: string;
  published_at: string | null;
  endpoint_count: number;
  status: "current" | "empty" | "identity_unavailable" | "not_published";
};

export type GithubSimulationPolicy = {
  integration_id: string;
  requested_mode: GithubSimulationMode;
  effective_mode: GithubSimulationEffectiveMode;
  observation_window_days: GithubSimulationObservationWindowDays;
  fallback_policy: GithubSimulationFallbackPolicy;
  log_connector_id: string | null;
  eligibility: GithubSimulationEligibility;
  privacy: GithubSimulationPrivacyReceipt;
  baseline: GithubSimulationBaseline;
};

export type GetGithubSimulationPolicyRequest = {
  integrationId: string;
  request?: RequestOptions;
};

export type UpdateGithubSimulationPolicyRequest = {
  integrationId: string;
  requestedMode?: GithubSimulationMode;
  observationWindowDays?: GithubSimulationObservationWindowDays;
  fallbackPolicy?: GithubSimulationFallbackPolicy;
  /** Set to null to clear the selected CloudWatch source. */
  logConnectorId?: string | null;
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
