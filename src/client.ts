import {
  type AddAppMemberRequest,
  type AddAppMemberResponse,
  type AppInstallSnippet,
  type AppPlaybookStep,
  type AppSetupStatus,
  type AuditEvent,
  type AuditLogResponse,
  type CallPlatformToolRequest,
  type CallPlatformToolResponse,
  type ConfigureEndpointProbeRequest,
  type CreateAppRequest,
  type CreateAppResponse,
  type CreateHealingRuleRequest,
  type DiscoverCapabilitiesRequest,
  type DiscoverCapabilitiesResponse,
  type EndpointDependenciesResponse,
  type EndpointHealthMetricsResponse,
  type GetEndpointDependenciesRequest,
  type GetEndpointHealthMetricsRequest,
  type GetAppResponse,
  type ImportMcpServerRequest,
  type ImportMcpServerResponse,
  type ListAppsResponse,
  type ListAppTemplatesResponse,
  type ListEndpointHealthRequest,
  type ListEndpointHealthResponse,
  type MintAppTokenRequest,
  type MintAppTokenResponse,
  type PremanAppMember,
  type PremanAppRecord,
  type PremanAppTemplate,
  type UpdateAppRequest,
  type CreateTokenRequest,
  type CreateTokenResponse,
  type DeployMcpRequest,
  type DeployMcpResponse,
  type CreateLocalStdioTunnelRequest,
  type GetCapabilitiesRequest,
  type GithubInstallRefreshResponse,
  type GithubInstallStartResponse,
  type GithubCommitListResponse,
  type GithubIntegration,
  type GithubIntegrationRemovalResponse,
  type GithubSimulationHandoffConversation,
  type GithubSimulationHandoffRequest,
  type GithubSimulationHandoffResponse,
  type GithubSimulationDetail,
  type GithubSimulationListResponse,
  type GithubSimulationPolicy,
  type GithubSimulationRun,
  type GithubWorkspaceSimulationReceipt,
  type GetGithubSimulationPolicyRequest,
  type GetGithubSimulationRequest,
  type GetLatestWorkspaceGithubSimulationRequest,
  type GetUpstreamHostingStatusRequest,
  type HostedMcpInstallSnippet,
  type GetHostedMcpResponse,
  type HostedMcpImportResponse,
  type HostedMcpRecord,
  type GetHostedMcpCatalogResponse,
  type EndpointIncident,
  type EndpointProbe,
  type FixTask,
  type HealingRule,
  type ImportFromDocsRequest,
  type ImportRemoteMcpRequest,
  type LocalStdioTunnelPollRequest,
  type LocalStdioTunnelPollResponse,
  type LocalStdioTunnelResponse,
  type ListHostedMcpsResponse,
  type ListGithubCommitsRequest,
  type ListGithubSimulationsRequest,
  type ListFixTasksRequest,
  type ListIncidentsRequest,
  type ListProbeResultsRequest,
  type ListTokensRequest,
  type ListTokensResponse,
  type PremanCapabilities,
  type PremanClientOptions,
  type ProbeResult,
  type RegisterEndpointsRequest,
  type RegisterEndpointsResponse,
  type RequestOptions,
  type RetryOptions,
  type RevokeTokenRequest,
  type RevokeTokenResponse,
  type RotateTokenRequest,
  type RotateTokenResponse,
  type SendLocalStdioTunnelMessageRequest,
  type UpdateHostedMcpRequest,
  type UpdateLocalStdioTunnelStatusRequest,
  type StartConsumerUpstreamOAuthRequest,
  type StartGithubSimulationRequest,
  type StartSelfHealingRequest,
  type StartSelfHealingResponse,
  type StartUpstreamOAuthRequest,
  type TokenMetadata,
  type UpdateGithubSimulationPolicyRequest,
  type UpstreamHostingRecord,
  type UpstreamOAuthProviderConfig,
  type UpstreamOAuthStartResponse,
  type VerifyTokenRequest,
  type VerifyTokenResponse,
  type WaitForSelfHealingRequest,
  type WaitForUpstreamHostingRequest,
} from "./types.js";
import { PremanAuthError, PremanConfigError, PremanError, PremanPolicyDeniedError } from "./errors.js";
import { normalizeHostedMcpCatalog } from "./catalog.js";
import {
  appDashboardUrl,
  appLlmsTxtUrl,
  appRuntimeUrl,
  normalizeDiscoveredCapability,
} from "./apps.js";
import {
  PREMAN_CAPABILITIES_PATH,
  buildUpstreamDeployBody,
  defaultPremanCapabilities,
  normalizePremanCapabilities,
  normalizeUpstreamHostingRecord,
} from "./upstream-hosting.js";
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
    const apiKey = (options.apiKey ?? process.env["PREMAN_API_KEY"] ?? "").trim();
    if (!apiKey) {
      throw new PremanConfigError(
        "Missing API key. Create one at https://app.preman.live/settings, then run `preman init --api-key pm_live_...` or set PREMAN_API_KEY.",
      );
    }
    if (!apiKey.startsWith("pm_live_")) {
      throw new PremanConfigError(
        "Invalid API key format. The SDK uses PreMan workspace API keys that start with `pm_live_`. Create one at https://app.preman.live/settings. Do not use a hosted MCP consumer token (`pm_hmcp_...`) or a login JWT.",
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

  /** List project-scoped endpoint health aggregates used by the Pulse endpoint view. */
  async listEndpointHealth(request: ListEndpointHealthRequest): Promise<ListEndpointHealthResponse> {
    requireString(request.projectId, "projectId");
    const params = endpointHealthQueryParams(request);
    if (request.sort) params.set("sort", request.sort);
    if (request.limit !== undefined) params.set("limit", String(request.limit));
    const query = params.size ? `?${params}` : "";
    const response = await this.request<Record<string, unknown>>(
      `/projects/${encodeURIComponent(request.projectId)}/api-runs/endpoints${query}`,
      { method: "GET", request: request.request },
    );
    return normalizeEndpointHealthList(response);
  }

  /** Get project-scoped health totals, latency percentiles, and sparkline buckets. */
  async getEndpointHealthMetrics(
    request: GetEndpointHealthMetricsRequest,
  ): Promise<EndpointHealthMetricsResponse> {
    requireString(request.projectId, "projectId");
    const params = endpointHealthQueryParams(request);
    if (request.endpointKey) params.set("endpoint_key", request.endpointKey);
    const query = params.size ? `?${params}` : "";
    const response = await this.request<Record<string, unknown>>(
      `/projects/${encodeURIComponent(request.projectId)}/api-runs/metrics${query}`,
      { method: "GET", request: request.request },
    );
    return normalizeEndpointHealthMetrics(response);
  }

  /** Get directed, evidence-backed dependencies used for failure blast-radius analysis. */
  async getEndpointDependencies(
    request: GetEndpointDependenciesRequest,
  ): Promise<EndpointDependenciesResponse> {
    requireString(request.projectId, "projectId");
    const response = await this.request<Record<string, unknown>>(
      `/projects/${encodeURIComponent(request.projectId)}/endpoint-dependencies`,
      { method: "GET", request: request.request },
    );
    return normalizeEndpointDependencies(response);
  }

  /** Configure continuous health testing for a saved API endpoint. */
  async configureEndpointProbe(request: ConfigureEndpointProbeRequest): Promise<EndpointProbe> {
    requireString(request.endpointId, "endpointId");
    const response = await this.request<Record<string, unknown>>(
      `/monitoring/endpoints/${encodeURIComponent(request.endpointId)}/probe`,
      {
        method: "PUT",
        body: omitUndefined({
          enabled: request.enabled ?? true,
          interval_seconds: request.intervalSeconds ?? 60,
          timeout_seconds: request.timeoutSeconds ?? 10,
          expected_status: request.expectedStatus,
          headers: request.headers,
          unattended_policy: request.unattendedPolicy ?? "read_only",
        }),
        request: request.request,
      },
    );
    return normalizeEndpointProbe(response);
  }

  async listEndpointProbes(request: RequestOptions = {}): Promise<EndpointProbe[]> {
    const response = await this.request<Record<string, unknown>>("/monitoring/probes", {
      method: "GET",
      request,
    });
    return arrayOfObjectsAt(response, "probes").map(normalizeEndpointProbe);
  }

  async removeEndpointProbe(endpointId: string, request: RequestOptions = {}): Promise<{ deleted: boolean }> {
    requireString(endpointId, "endpointId");
    const response = await this.request<Record<string, unknown>>(
      `/monitoring/endpoints/${encodeURIComponent(endpointId)}/probe`,
      { method: "DELETE", request },
    );
    return { deleted: response["deleted"] === true };
  }

  async listEndpointProbeResults(request: ListProbeResultsRequest): Promise<ProbeResult[]> {
    requireString(request.endpointId, "endpointId");
    const params = new URLSearchParams();
    if (request.limit !== undefined) params.set("limit", String(request.limit));
    const query = params.size ? `?${params}` : "";
    const response = await this.request<Record<string, unknown>>(
      `/monitoring/endpoints/${encodeURIComponent(request.endpointId)}/results${query}`,
      { method: "GET", request: request.request },
    );
    return arrayOfObjectsAt(response, "results").map(normalizeProbeResult);
  }

  /**
   * Create a failure rule for an endpoint. Native self-healing is enabled by
   * default so a fired incident can move directly into repair and validation.
   */
  async createHealingRule(request: CreateHealingRuleRequest): Promise<HealingRule> {
    requireString(request.targetId, "targetId");
    const ruleType = request.ruleType ?? "consecutive_failures";
    const response = await this.request<Record<string, unknown>>("/monitoring/alert-rules", {
      method: "POST",
      body: omitUndefined({
        name: request.name ?? "Self-heal failing endpoint",
        target_kind: request.targetKind ?? "endpoint",
        target_id: request.targetId,
        rule_type: ruleType,
        threshold_failures: ruleType === "consecutive_failures"
          ? (request.thresholdFailures ?? 3)
          : request.thresholdFailures,
        error_rate_threshold: request.errorRateThreshold,
        window_minutes: request.windowMinutes,
        min_samples: request.minSamples ?? 5,
        channel_ids: request.channelIds ?? [],
        enabled: request.enabled ?? true,
        autofix_enabled: request.autofixEnabled ?? true,
        quiet_hours_start: request.quietHoursStart,
        quiet_hours_end: request.quietHoursEnd,
      }),
      request: request.request,
    });
    return normalizeHealingRule(response);
  }

  async listHealingRules(request: RequestOptions = {}): Promise<HealingRule[]> {
    const response = await this.request<Record<string, unknown>>("/monitoring/alert-rules", {
      method: "GET",
      request,
    });
    return arrayOfObjectsAt(response, "rules").map(normalizeHealingRule);
  }

  async listEndpointIncidents(request: ListIncidentsRequest = {}): Promise<EndpointIncident[]> {
    const params = new URLSearchParams();
    if (request.ruleId) params.set("rule_id", request.ruleId);
    if (request.limit !== undefined) params.set("limit", String(request.limit));
    const query = params.size ? `?${params}` : "";
    const response = await this.request<Record<string, unknown>>(`/monitoring/alert-events${query}`, {
      method: "GET",
      request: request.request,
    });
    return arrayOfObjectsAt(response, "events").map(normalizeEndpointIncident);
  }

  async listFixTasks(request: ListFixTasksRequest = {}): Promise<FixTask[]> {
    const params = new URLSearchParams();
    if (request.status) params.set("status", request.status);
    if (request.limit !== undefined) params.set("limit", String(request.limit));
    const query = params.size ? `?${params}` : "";
    const response = await this.request<Record<string, unknown>>(`/monitoring/fix-tasks${query}`, {
      method: "GET",
      request: request.request,
    });
    return arrayOfObjectsAt(response, "fix_tasks").map(normalizeFixTask);
  }

  async getFixTask(fixTaskId: string, request: RequestOptions = {}): Promise<FixTask> {
    requireString(fixTaskId, "fixTaskId");
    const response = await this.request<Record<string, unknown>>(
      `/monitoring/fix-tasks/${encodeURIComponent(fixTaskId)}`,
      { method: "GET", request },
    );
    return normalizeFixTask(response);
  }

  /** Queue PreMan's native repair, validation, branch, and PR workflow. */
  async startSelfHealing(request: StartSelfHealingRequest): Promise<StartSelfHealingResponse> {
    requireString(request.fixTaskId, "fixTaskId");
    const response = await this.request<Record<string, unknown>>(
      `/monitoring/fix-tasks/${encodeURIComponent(request.fixTaskId)}/autofix`,
      { method: "POST", request: request.request },
    );
    return {
      fixTaskId: stringAt(response, "fix_task_id") || request.fixTaskId,
      dispatch: objectAt(response, "dispatch"),
      raw: response,
    };
  }

  /** Wait until a native repair finishes, fails, or the timeout expires. */
  async waitForSelfHealing(request: WaitForSelfHealingRequest): Promise<FixTask> {
    requireString(request.fixTaskId, "fixTaskId");
    const pollIntervalMs = request.pollIntervalMs ?? 3_000;
    const timeoutMs = request.timeoutMs ?? 300_000;
    const started = Date.now();
    while (true) {
      const task = await this.getFixTask(request.fixTaskId, request.request);
      if (task.dispatchStage === "done" || task.status === "resolved") return task;
      if (task.dispatchStage === "failed") {
        throw new PremanError("Self-healing failed. Inspect the fix task dispatch result for details.", {
          status: 424,
          body: task.raw,
        });
      }
      if (Date.now() - started >= timeoutMs) {
        throw new PremanError(
          `Timed out waiting for self-healing to complete (last stage: ${task.dispatchStage ?? "pending"}).`,
          { status: 408, body: task.raw },
        );
      }
      await sleep(pollIntervalMs);
    }
  }

  async resolveFixTask(fixTaskId: string, request: RequestOptions = {}): Promise<FixTask> {
    requireString(fixTaskId, "fixTaskId");
    const response = await this.request<Record<string, unknown>>(
      `/monitoring/fix-tasks/${encodeURIComponent(fixTaskId)}/resolve`,
      { method: "POST", request },
    );
    return normalizeFixTask(objectAt(response, "fix_task"));
  }

  async getCapabilities(request: GetCapabilitiesRequest = {}): Promise<PremanCapabilities> {
    try {
      const response = await this.request<Record<string, unknown>>(PREMAN_CAPABILITIES_PATH, {
        method: "GET",
        request: request.request,
      });
      return normalizePremanCapabilities(response);
    } catch (error) {
      if (error instanceof PremanError && error.status === 404) {
        return defaultPremanCapabilities();
      }
      throw error;
    }
  }

  /** Start the GitHub App authorization and repository-selection flow. */
  async startGithubInstall(request: RequestOptions = {}): Promise<GithubInstallStartResponse> {
    return this.request<GithubInstallStartResponse>("/integrations/github/app/install", {
      method: "POST",
      request,
    });
  }

  /** Reconcile repositories after changing an existing GitHub App installation. */
  async refreshGithubInstallations(
    request: RequestOptions = {},
  ): Promise<GithubInstallRefreshResponse> {
    return this.request<GithubInstallRefreshResponse>("/integrations/github/app/refresh", {
      method: "POST",
      request,
    });
  }

  /** List the current workspace's connected GitHub repositories. */
  async listGithubIntegrations(request: RequestOptions = {}): Promise<GithubIntegration[]> {
    return this.request<GithubIntegration[]>("/integrations/github", {
      method: "GET",
      request,
    });
  }

  /** Soft-disconnect one GitHub repository and its derived PreMan endpoints. */
  async removeGithubIntegration(
    integrationId: string,
    request: RequestOptions = {},
  ): Promise<GithubIntegrationRemovalResponse> {
    requireString(integrationId, "integrationId");
    return this.request<GithubIntegrationRemovalResponse>(
      `/integrations/github/${encodeURIComponent(integrationId)}`,
      { method: "DELETE", request },
    );
  }

  /**
   * Hand a completed, non-empty GitHub simulation diff to the configured coding agent.
   * PreMan authors the repair instructions and persists the task as a normal workbench chat.
   */
  async handoffGithubSimulation(
    request: GithubSimulationHandoffRequest,
  ): Promise<GithubSimulationHandoffResponse> {
    requireString(request.integrationId, "integrationId");
    requireString(request.runId, "runId");
    if (request.workspaceId !== undefined) requireString(request.workspaceId, "workspaceId");
    const requestOptions = request.workspaceId
      ? {
          ...request.request,
          headers: {
            ...request.request?.headers,
            "x-workspace-id": request.workspaceId,
          },
        }
      : request.request;
    const response = await this.request<Record<string, unknown>>(
      `/integrations/github/${encodeURIComponent(request.integrationId)}/simulations/${encodeURIComponent(request.runId)}/handoff`,
      { method: "POST", request: requestOptions },
    );
    const rawConversation = objectOrNullAt(response, "conversation");
    return {
      fixTask: objectAt(response, "fix_task"),
      dispatch: objectOrNullAt(response, "dispatch"),
      artifact: objectAt(response, "artifact"),
      alreadyExisted: response["already_existed"] === true,
      conversation: rawConversation
        ? normalizeGithubSimulationHandoffConversation(rawConversation)
        : null,
      raw: response,
    };
  }

  /** List recent commits using the repository's server-managed GitHub connection. */
  async listGithubCommits(request: ListGithubCommitsRequest): Promise<GithubCommitListResponse> {
    requireString(request.integrationId, "integrationId");
    const params = new URLSearchParams();
    if (request.limit !== undefined) params.set("limit", String(request.limit));
    const query = params.size ? `?${params}` : "";
    return this.request<GithubCommitListResponse>(
      `/integrations/github/${encodeURIComponent(request.integrationId)}/commits${query}`,
      { method: "GET", request: request.request },
    );
  }

  /** List durable simulation runs for one connected GitHub repository. */
  async listGithubSimulations(
    request: ListGithubSimulationsRequest,
  ): Promise<GithubSimulationListResponse> {
    requireString(request.integrationId, "integrationId");
    const params = new URLSearchParams();
    if (request.limit !== undefined) params.set("limit", String(request.limit));
    if (request.offset !== undefined) params.set("offset", String(request.offset));
    const query = params.size ? `?${params}` : "";
    return this.request<GithubSimulationListResponse>(
      `/integrations/github/${encodeURIComponent(request.integrationId)}/simulations${query}`,
      { method: "GET", request: request.request },
    );
  }

  /** Read one durable simulation, including terminal evidence and signed-push identity. */
  async getGithubSimulation(request: GetGithubSimulationRequest): Promise<GithubSimulationDetail> {
    requireString(request.integrationId, "integrationId");
    requireString(request.runId, "runId");
    return this.request<GithubSimulationDetail>(
      `/integrations/github/${encodeURIComponent(request.integrationId)}/simulations/${encodeURIComponent(request.runId)}`,
      { method: "GET", request: request.request },
    );
  }

  /** Queue a manual simulation; GitHub credentials remain managed by PreMan. */
  async startGithubSimulation(
    request: StartGithubSimulationRequest,
  ): Promise<GithubSimulationRun> {
    requireString(request.integrationId, "integrationId");
    if (request.ref !== undefined) requireString(request.ref, "ref");
    if (request.commitSha !== undefined && !/^[0-9A-Fa-f]{40}$/.test(request.commitSha)) {
      throw new PremanConfigError("commitSha must be a 40-character Git commit SHA.");
    }
    const body = omitUndefined({ ref: request.ref, commit_sha: request.commitSha });
    return this.request<GithubSimulationRun>(
      `/integrations/github/${encodeURIComponent(request.integrationId)}/simulations`,
      {
        method: "POST",
        ...(Object.keys(body).length ? { body } : {}),
        request: request.request,
      },
    );
  }

  /** Return the newest signed-push simulation receipt for a Workbench workspace. */
  async getLatestWorkspaceGithubSimulation(
    request: GetLatestWorkspaceGithubSimulationRequest,
  ): Promise<GithubWorkspaceSimulationReceipt> {
    requireString(request.workspaceId, "workspaceId");
    return this.request<GithubWorkspaceSimulationReceipt>(
      "/integrations/github/workspace-simulation/latest",
      {
        method: "GET",
        request: {
          ...request.request,
          headers: {
            ...request.request?.headers,
            "X-Workspace-Id": request.workspaceId,
          },
        },
      },
    );
  }

  /** Read the repository's selected simulation evidence policy and eligibility. */
  async getGithubSimulationPolicy(
    request: GetGithubSimulationPolicyRequest,
  ): Promise<GithubSimulationPolicy> {
    requireString(request.integrationId, "integrationId");
    return this.request<GithubSimulationPolicy>(
      `/integrations/github/${encodeURIComponent(request.integrationId)}/simulation-policy`,
      { method: "GET", request: request.request },
    );
  }

  /** Update the repository's privacy-safe simulation evidence policy. */
  async updateGithubSimulationPolicy(
    request: UpdateGithubSimulationPolicyRequest,
  ): Promise<GithubSimulationPolicy> {
    requireString(request.integrationId, "integrationId");
    if (request.logConnectorId !== undefined && request.logConnectorId !== null) {
      requireString(request.logConnectorId, "logConnectorId");
    }
    const body = omitUndefined({
      requested_mode: request.requestedMode,
      observation_window_days: request.observationWindowDays,
      fallback_policy: request.fallbackPolicy,
      log_connector_id: request.logConnectorId,
    });
    if (Object.keys(body).length === 0) {
      throw new PremanConfigError("Provide at least one simulation policy field.");
    }
    return this.request<GithubSimulationPolicy>(
      `/integrations/github/${encodeURIComponent(request.integrationId)}/simulation-policy`,
      { method: "PATCH", body, request: request.request },
    );
  }

  async getUpstreamHostingStatus(request: GetUpstreamHostingStatusRequest): Promise<UpstreamHostingRecord> {
    requireString(request.mcpId, "mcpId");
    const response = await this.request<Record<string, unknown>>(
      `/hosted-mcps/${encodeURIComponent(request.mcpId)}/upstream-hosting`,
      { method: "GET", request: request.request },
    );
    const hosting = objectAt(response, "upstream_hosting");
    const payload = Object.keys(hosting).length ? hosting : response;
    return normalizeUpstreamHostingRecord(request.mcpId, payload);
  }

  async waitForUpstreamHosting(request: WaitForUpstreamHostingRequest): Promise<UpstreamHostingRecord> {
    const pollIntervalMs = request.pollIntervalMs ?? 3_000;
    const timeoutMs = request.timeoutMs ?? 300_000;
    const readyStatuses = request.readyStatuses ?? ["running"];
    const started = Date.now();

    while (true) {
      const status = await this.getUpstreamHostingStatus(request);
      if (readyStatuses.includes(status.status)) {
        return status;
      }
      if (status.status === "failed" || status.status === "stopped") {
        throw new PremanError(
          status.message || `Upstream hosting entered status "${status.status}".`,
          { status: 424, body: status.raw },
        );
      }
      if (Date.now() - started >= timeoutMs) {
        throw new PremanError(
          `Timed out waiting for upstream hosting to reach ${readyStatuses.join(" or ")} (last status: ${status.status}).`,
          { status: 408, body: status.raw },
        );
      }
      await sleep(pollIntervalMs);
    }
  }

  async deployMcp(request: DeployMcpRequest): Promise<DeployMcpResponse> {
    requireString(request.name, "name");
    if (!request.endpoints?.length) {
      throw new PremanConfigError("deployMcp requires endpoints.");
    }
    const sessionId = request.sessionId ?? randomUUID();
    const upstreamFields = buildUpstreamDeployBody(request);
    const response = await this.request<Record<string, unknown>>(`/agent-sessions/${encodeURIComponent(sessionId)}/mcp/deploy`, {
      method: "POST",
      body: omitUndefined({
        name: request.name,
        ...upstreamFields,
        endpoints: request.endpoints.map(toBackendEndpoint),
        initial_upstream_secret: request.initialUpstreamSecret,
        initial_upstream_secret_type: request.initialUpstreamSecretType,
        upstream_auth_style: request.upstreamAuthStyle,
        initial_consumer_label: request.initialConsumerLabel === undefined ? "default-consumer" : request.initialConsumerLabel,
        upstream_oauth_provider: request.upstreamOAuthProvider
          ? toBackendOAuthProvider(request.upstreamOAuthProvider)
          : undefined,
        access_mode: request.accessMode,
      }),
      request: request.request,
    });
    return normalizeDeployMcpResponse(response, request.name, this.appUrl);
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

  async updateHostedMcp(request: UpdateHostedMcpRequest): Promise<GetHostedMcpResponse> {
    requireString(request.mcpId, "mcpId");
    const response = await this.request<Record<string, unknown>>(
      `/hosted-mcps/${encodeURIComponent(request.mcpId)}`,
      {
        method: "PATCH",
        body: omitUndefined({
          name: request.name,
          llms_txt_markdown: request.llmsTxtMarkdown,
          upstream_base_url: request.upstreamBaseUrl,
          upstream_auth_style: request.upstreamAuthStyle,
          endpoint_selection: request.endpointSelection,
          tool_schema_overrides: request.toolSchemaOverrides,
          status: request.status,
          access_mode: request.accessMode,
          human_approval_required: request.humanApprovalRequired,
          sync_coherence_check: request.syncCoherenceCheck,
          verification_tier: request.verificationTier,
        }),
        request: request.request,
      },
    );
    return {
      hostedMcp: objectAt(response, "hosted_mcp") as HostedMcpRecord,
      raw: response,
    };
  }

  async startUpstreamOAuth(request: StartUpstreamOAuthRequest): Promise<UpstreamOAuthStartResponse> {
    requireString(request.mcpId, "mcpId");
    const response = await this.request<Record<string, unknown>>(
      `/hosted-mcps/${encodeURIComponent(request.mcpId)}/upstream-oauth/start`,
      { method: "POST", request: request.request },
    );
    return normalizeUpstreamOAuthStart(response);
  }

  async startConsumerUpstreamOAuth(
    request: StartConsumerUpstreamOAuthRequest,
  ): Promise<UpstreamOAuthStartResponse> {
    requireString(request.mcpId, "mcpId");
    requireString(request.consumerToken, "consumerToken");
    const apiUrl = stripTrailingSlash(request.apiUrl ?? this.apiUrl);
    const timeoutMs = request.request?.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${apiUrl}/h/${encodeURIComponent(request.mcpId)}/upstream-oauth/start`;

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${request.consumerToken}`,
          "Content-Type": "application/json",
          "User-Agent": "preman-sdk",
          ...request.request?.headers,
        },
      });
      clearTimeout(timeout);
      const body = await readBody(response);
      if (!response.ok) {
        throw errorFromResponse(response, body);
      }
      return normalizeUpstreamOAuthStart(
        body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {},
      );
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
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

  async discoverCapabilities(request: DiscoverCapabilitiesRequest): Promise<DiscoverCapabilitiesResponse> {
    requireString(request.query, "query");
    const params = new URLSearchParams({
      q: request.query.trim(),
      limit: String(request.limit ?? 10),
    });
    const response = await this.request<Record<string, unknown>>(`/capabilities/search?${params}`, {
      method: "GET",
      request: request.request,
    });
    const rawMatches = arrayOfObjectsAt(response, "results").length
      ? arrayOfObjectsAt(response, "results")
      : arrayOfObjectsAt(response, "matches");
    return {
      query: stringAt(response, "query") || request.query,
      matches: rawMatches.map((match) => normalizeDiscoveredCapability(match)),
      total: numberAt(response, "total") || rawMatches.length,
      raw: response,
    };
  }

  async listApps(request: RequestOptions = {}): Promise<ListAppsResponse> {
    const response = await this.request<Record<string, unknown>>("/apps", {
      method: "GET",
      request,
    });
    const apps = arrayOfObjectsAt(response, "apps").map(normalizeAppRecord);
    return {
      apps,
      total: numberAt(response, "total") || apps.length,
      raw: response,
    };
  }

  async listAppTemplates(request: RequestOptions = {}): Promise<ListAppTemplatesResponse> {
    const response = await this.request<Record<string, unknown>>("/apps/templates", {
      method: "GET",
      request,
    });
    const templates = arrayOfObjectsAt(response, "templates") as PremanAppTemplate[];
    return {
      templates,
      total: numberAt(response, "total") || templates.length,
      raw: response,
    };
  }

  async getApp(slug: string, request: RequestOptions = {}): Promise<GetAppResponse> {
    requireString(slug, "slug");
    const response = await this.request<Record<string, unknown>>(`/apps/${encodeURIComponent(slug)}`, {
      method: "GET",
      request,
    });
    return {
      app: normalizeAppRecord(objectAt(response, "app")),
      raw: response,
    };
  }

  async getAppProfile(profileId: string, request: RequestOptions = {}): Promise<GetAppResponse> {
    requireString(profileId, "profileId");
    const response = await this.request<Record<string, unknown>>(
      `/managed-mcps/profiles/${encodeURIComponent(profileId)}`,
      { method: "GET", request },
    );
    return {
      app: normalizeAppRecord(objectAt(response, "profile")),
      raw: response,
    };
  }

  async getAppSetupStatus(slug: string, request: RequestOptions = {}): Promise<AppSetupStatus> {
    requireString(slug, "slug");
    const response = await this.request<Record<string, unknown>>(
      `/apps/${encodeURIComponent(slug)}/setup-status`,
      { method: "GET", request },
    );
    return normalizeAppSetupStatus(objectAt(response, "setup_status"));
  }

  async createApp(request: CreateAppRequest): Promise<CreateAppResponse> {
    requireString(request.name, "name");
    const response = await this.request<Record<string, unknown>>("/managed-mcps/profiles", {
      method: "POST",
      body: omitUndefined({
        name: request.name,
        slug: request.slug,
        template_key: request.templateKey ?? request.template_key,
        members: (request.members ?? []).map(toBackendAppMember),
        access_mode: request.accessMode ?? request.access_mode,
        llms_txt_markdown: request.llmsTxtMarkdown ?? request.llms_txt_markdown,
        setup_playbook_json: request.setupPlaybookJson ?? request.setup_playbook_json,
        branding: request.branding,
        mint_consumer_token: request.mintConsumerToken ?? request.mint_consumer_token ?? true,
        consumer_label: request.consumerLabel ?? request.consumer_label ?? "default",
      }),
      request: request.request,
    });
    const profile = normalizeAppRecord(objectAt(response, "profile"));
    const slug = profile.slug;
    return {
      profile,
      consumerToken: objectOrUndefinedAt(response, "consumer_token"),
      rawToken: nullableStringAt(response, "raw_token"),
      installSnippet: normalizeAppInstallSnippet(objectAt(response, "install_snippet"), slug, this.apiUrl),
      dashboardUrl: appDashboardUrl(this.appUrl, profile.id),
      runtimeUrl: appRuntimeUrl(this.apiUrl, slug),
      llmsTxtUrl: appLlmsTxtUrl(this.apiUrl, slug),
      raw: response,
    };
  }

  async updateApp(request: UpdateAppRequest): Promise<GetAppResponse> {
    requireString(request.slug, "slug");
    const response = await this.request<Record<string, unknown>>(
      `/apps/${encodeURIComponent(request.slug)}`,
      {
        method: "PATCH",
        body: omitUndefined({
          name: request.name,
          status: request.status,
          llms_txt_markdown: request.llmsTxtMarkdown ?? request.llms_txt_markdown,
          setup_playbook_json: request.setupPlaybookJson ?? request.setup_playbook_json,
          branding: request.branding,
          access_mode: request.accessMode ?? request.access_mode,
          template_key: request.templateKey ?? request.template_key,
        }),
        request: request.request,
      },
    );
    return {
      app: normalizeAppRecord(objectAt(response, "app")),
      raw: response,
    };
  }

  async deleteApp(slug: string, request: RequestOptions = {}): Promise<{ ok: boolean }> {
    requireString(slug, "slug");
    const response = await this.request<Record<string, unknown>>(
      `/apps/${encodeURIComponent(slug)}`,
      { method: "DELETE", request },
    );
    return { ok: response["ok"] === true };
  }

  async importMcpServer(request: ImportMcpServerRequest): Promise<ImportMcpServerResponse> {
    const response = await this.request<Record<string, unknown>>("/managed-mcps/import", {
      method: "POST",
      body: omitUndefined({
        config: request.config,
        mcp_url: request.mcpUrl ?? request.mcp_url,
        name: request.name,
        initial_secret: request.initialSecret ?? request.initial_secret,
        initial_secret_type: request.initialSecretType ?? request.initial_secret_type,
      }),
      request: request.request,
    });
    return {
      server: objectAt(response, "server") as ImportMcpServerResponse["server"],
      initialCredential: objectOrNullAt(response, "initial_credential"),
      raw: response,
    };
  }

  async addAppMember(request: AddAppMemberRequest): Promise<AddAppMemberResponse> {
    requireString(request.profileId, "profileId");
    requireString(request.prefix, "prefix");
    const response = await this.request<Record<string, unknown>>(
      `/managed-mcps/profiles/${encodeURIComponent(request.profileId)}/members`,
      {
        method: "POST",
        body: omitUndefined({
          server_id: request.serverId ?? request.server_id,
          hosted_mcp_id: request.hostedMcpId ?? request.hosted_mcp_id,
          prefix: request.prefix,
          display_name: request.displayName ?? request.display_name,
        }),
        request: request.request,
      },
    );
    return {
      profile: normalizeAppRecord(objectAt(response, "profile")),
      raw: response,
    };
  }

  async mintAppToken(request: MintAppTokenRequest): Promise<MintAppTokenResponse> {
    requireString(request.profileId, "profileId");
    const response = await this.request<Record<string, unknown>>(
      `/managed-mcps/profiles/${encodeURIComponent(request.profileId)}/install`,
      { method: "GET", request: request.request },
    );
    const slug = stringAt(response, "slug");
    return {
      profileId: stringAt(response, "profile_id") || request.profileId,
      slug,
      consumerToken: objectOrUndefinedAt(response, "consumer_token"),
      rawToken: nullableStringAt(response, "raw_token"),
      installSnippet: normalizeAppInstallSnippet(objectAt(response, "install_snippet"), slug, this.apiUrl),
      runtimeUrl: appRuntimeUrl(this.apiUrl, slug),
      llmsTxtUrl: appLlmsTxtUrl(this.apiUrl, slug),
      raw: response,
    };
  }

  /**
   * Invoke any PreMan platform tool over HTTP (same surface as preman-mcp and skill.md).
   * Use createPremanAgentTools() when building LangChain or other agentic workflows.
   */
  async callPlatformTool(request: CallPlatformToolRequest): Promise<CallPlatformToolResponse> {
    requireString(request.tool, "tool");
    const result = await this.request<unknown>("/mcp/call-tool", {
      method: "POST",
      body: {
        tool: request.tool,
        arguments: request.arguments ?? {},
      },
      request: request.request,
    });
    return {
      tool: request.tool,
      result: normalizePlatformToolResult(result),
      raw: result,
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

function normalizeEndpointProbe(raw: Record<string, unknown>): EndpointProbe {
  const method = stringAt(raw, "method").toUpperCase();
  return {
    id: stringAt(raw, "id"),
    endpointId: stringAt(raw, "endpoint_id"),
    enabled: raw["enabled"] !== false,
    intervalSeconds: numberAt(raw, "interval_seconds"),
    timeoutSeconds: numberAt(raw, "timeout_seconds"),
    expectedStatus: nullableNumberAt(raw, "expected_status"),
    headerKeys: stringArrayAt(raw, "header_keys"),
    hasCustomHeaders: raw["has_custom_headers"] === true,
    nextDueAt: nullableStringAt(raw, "next_due_at"),
    lastRunAt: nullableStringAt(raw, "last_run_at"),
    method: isHttpMethod(method) ? method : undefined,
    pathTemplate: stringOrUndefined(raw, "path_template"),
    baseUrl: stringOrUndefined(raw, "base_url"),
    raw,
  };
}

function normalizeProbeResult(raw: Record<string, unknown>): ProbeResult {
  return {
    timestamp: stringAt(raw, "ts"),
    ok: raw["ok"] === true,
    responseStatus: nullableNumberAt(raw, "response_status"),
    latencyMs: nullableNumberAt(raw, "latency_ms"),
    error: nullableStringAt(raw, "error"),
    raw,
  };
}

function normalizeHealingRule(raw: Record<string, unknown>): HealingRule {
  return {
    id: stringAt(raw, "id"),
    name: stringAt(raw, "name"),
    targetKind: stringAt(raw, "target_kind") as HealingRule["targetKind"],
    targetId: stringAt(raw, "target_id"),
    ruleType: stringAt(raw, "rule_type") as HealingRule["ruleType"],
    thresholdFailures: nullableNumberAt(raw, "threshold_failures"),
    errorRateThreshold: nullableNumberAt(raw, "error_rate_threshold"),
    windowMinutes: nullableNumberAt(raw, "window_minutes"),
    minSamples: numberAt(raw, "min_samples"),
    channelIds: stringArrayAt(raw, "channel_ids"),
    enabled: raw["enabled"] !== false,
    autofixEnabled: raw["autofix_enabled"] === true,
    quietHoursStart: nullableNumberAt(raw, "quiet_hours_start"),
    quietHoursEnd: nullableNumberAt(raw, "quiet_hours_end"),
    lastEvaluatedAt: nullableStringAt(raw, "last_evaluated_at"),
    createdAt: nullableStringAt(raw, "created_at"),
    raw,
  };
}

function normalizeEndpointIncident(raw: Record<string, unknown>): EndpointIncident {
  return {
    id: stringAt(raw, "id"),
    ruleId: stringAt(raw, "rule_id"),
    firedAt: nullableStringAt(raw, "fired_at"),
    resolvedAt: nullableStringAt(raw, "resolved_at"),
    trigger: objectAt(raw, "trigger"),
    deliveries: arrayOfObjectsAt(raw, "deliveries"),
    resolutionDeliveries: arrayOfObjectsAt(raw, "resolve_deliveries"),
    deliveryPending: raw["delivery_pending"] === true,
    raw,
  };
}

function normalizeFixTask(raw: Record<string, unknown>): FixTask {
  return {
    id: stringAt(raw, "id"),
    workspaceId: nullableStringAt(raw, "workspace_id"),
    sourceKind: stringAt(raw, "source_kind"),
    sourceId: stringAt(raw, "source_id"),
    status: stringAt(raw, "status") as FixTask["status"],
    package: objectAt(raw, "package"),
    githubIssueUrl: nullableStringAt(raw, "github_issue_url"),
    jiraIssueUrl: nullableStringAt(raw, "jira_issue_url"),
    prUrl: nullableStringAt(raw, "pr_url"),
    executor: nullableStringAt(raw, "executor"),
    dispatchProvider: nullableStringAt(raw, "dispatch_provider"),
    dispatchRunId: nullableStringAt(raw, "dispatch_run_id"),
    dispatchRunUrl: nullableStringAt(raw, "dispatch_run_url"),
    dispatchStatus: nullableStringAt(raw, "dispatch_status"),
    dispatchStage: nullableStringAt(raw, "dispatch_stage"),
    dispatchResult: raw["dispatch_result"],
    dispatchAttempts: numberAt(raw, "dispatch_attempts"),
    dispatchedAt: nullableStringAt(raw, "dispatched_at"),
    deliveredAt: nullableStringAt(raw, "delivered_at"),
    resolvedAt: nullableStringAt(raw, "resolved_at"),
    createdAt: nullableStringAt(raw, "created_at"),
    updatedAt: nullableStringAt(raw, "updated_at"),
    raw,
  };
}

function nullableNumberAt(value: Record<string, unknown>, key: string): number | null | undefined {
  const item = value[key];
  if (item === null) return null;
  return typeof item === "number" ? item : undefined;
}

function isHttpMethod(value: string): value is EndpointProbe["method"] & string {
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(value);
}

function endpointHealthQueryParams(
  request: ListEndpointHealthRequest | GetEndpointHealthMetricsRequest,
): URLSearchParams {
  if ((request.start === undefined) !== (request.end === undefined)) {
    throw new PremanConfigError("start and end must be supplied together.");
  }
  const params = new URLSearchParams();
  if (request.window) params.set("window", request.window);
  if (request.start !== undefined && request.end !== undefined) {
    params.set("start", endpointHealthDate(request.start, "start"));
    params.set("end", endpointHealthDate(request.end, "end"));
  }
  if (request.method) params.set("method", request.method);
  for (const status of request.statuses ?? []) params.append("status", status);
  if (request.origin) params.set("origin", request.origin);
  if (request.originLabel) params.set("origin_label", request.originLabel);
  if (request.environmentId) params.set("env_id", request.environmentId);
  if (request.minLatencyMs !== undefined) params.set("min_latency_ms", String(request.minLatencyMs));
  if (request.query) params.set("q", request.query);
  return params;
}

function endpointHealthDate(value: string | Date, field: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new PremanConfigError(`${field} must be a valid Date.`);
    return value.toISOString();
  }
  if (!value.trim()) throw new PremanConfigError(`${field} must be a non-empty ISO timestamp.`);
  return value;
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

function toBackendOAuthProvider(profile: UpstreamOAuthProviderConfig): Record<string, unknown> {
  return omitUndefined({
    provider: profile.provider,
    authorization_endpoint: profile.authorizationEndpoint,
    token_endpoint: profile.tokenEndpoint,
    scopes: profile.scopes,
    client_id: profile.clientId,
    client_secret: profile.clientSecret,
  });
}

function normalizeDeployMcpResponse(
  response: Record<string, unknown>,
  fallbackName: string,
  appUrl: string,
): DeployMcpResponse {
  const hosted = objectAt(response, "hosted_mcp");
  const mcpId = stringAt(hosted, "id");
  const name = stringAt(hosted, "name") || fallbackName;
  const hostedUrl = stringAt(response, "hosted_mcp_url");
  const upstreamHostingRaw = objectAt(response, "upstream_hosting");
  const upstreamModeRaw = response["upstream_mode"] ?? hosted["upstream_mode"] ?? upstreamHostingRaw["upstream_mode"];
  const upstreamMode = upstreamModeRaw === "preman" || upstreamModeRaw === "external" ? upstreamModeRaw : undefined;
  const upstreamHosting = Object.keys(upstreamHostingRaw).length
    ? normalizeUpstreamHostingRecord(mcpId, upstreamHostingRaw)
    : upstreamMode === "preman"
      ? normalizeUpstreamHostingRecord(mcpId, {
          upstream_mode: "preman",
          status: response["upstream_status"] ?? hosted["upstream_status"] ?? "pending",
          upstream_base_url: hosted["upstream_base_url"] ?? response["upstream_base_url"],
        })
      : null;

  return {
    mcpId,
    name,
    hostedUrl,
    dashboardUrl: `${appUrl}/hosted-mcps/${encodeURIComponent(mcpId)}`,
    toolCount: numberAt(response, "tool_count"),
    upstreamMode,
    upstreamHosting,
    rawConsumerToken: nullableStringAt(response, "raw_consumer_token"),
    consumerToken: objectAt(response, "consumer_token"),
    installSnippet: normalizeInstallSnippet(objectAt(response, "install_snippet")),
  };
}

function normalizeUpstreamOAuthStart(response: Record<string, unknown>): UpstreamOAuthStartResponse {
  return {
    authorizationUrl: stringAt(response, "authorization_url") || stringAt(response, "authorizationUrl"),
    state: stringAt(response, "state"),
    expiresAt: stringAt(response, "expires_at") || stringAt(response, "expiresAt"),
    provider: stringAt(response, "provider"),
    instructions: stringAt(response, "instructions"),
  };
}

function objectAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const item = value[key];
  return item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
}

function normalizeGithubSimulationHandoffConversation(
  conversation: Record<string, unknown>,
): GithubSimulationHandoffConversation {
  return {
    id: stringAt(conversation, "id"),
    workspaceId: stringAt(conversation, "workspace_id"),
    title: stringAt(conversation, "title"),
    archived: conversation["archived"] === true,
    taskInProgress: conversation["task_in_progress"] === true,
    createdAt: nullableStringAt(conversation, "created_at"),
    updatedAt: nullableStringAt(conversation, "updated_at"),
    messages: arrayOfObjectsAt(conversation, "messages").map((message) => ({
      id: stringAt(message, "id"),
      role: stringAt(message, "role"),
      content: stringAt(message, "content"),
      artifacts: arrayOfObjectsAt(message, "artifacts"),
      provider: nullableStringAt(message, "provider"),
      model: nullableStringAt(message, "model"),
      createdAt: nullableStringAt(message, "created_at"),
      raw: message,
    })),
    raw: conversation,
  };
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

function normalizeEndpointHealthList(
  response: Record<string, unknown>,
): ListEndpointHealthResponse {
  const observations = objectAt(response, "observations");
  return {
    projectId: stringAt(response, "project_id"),
    window: stringAt(response, "window") as ListEndpointHealthResponse["window"],
    start: stringAt(response, "start"),
    end: stringAt(response, "end"),
    sort: stringAt(response, "sort") as ListEndpointHealthResponse["sort"],
    endpoints: arrayOfObjectsAt(response, "endpoints").map((endpoint) => ({
      endpointKey: stringAt(endpoint, "endpoint_key"),
      method: stringAt(endpoint, "method"),
      host: stringAt(endpoint, "host"),
      pathTemplate: stringAt(endpoint, "path_template"),
      runs: numberAt(endpoint, "runs"),
      failures: numberAt(endpoint, "failures"),
      errorRate: numberAt(endpoint, "error_rate"),
      p50Ms: numberAt(endpoint, "p50_ms"),
      p95Ms: numberAt(endpoint, "p95_ms"),
      p99Ms: numberAt(endpoint, "p99_ms"),
      lastRunAt: nullableStringAt(endpoint, "last_run_at"),
    })),
    observations: {
      probes: arrayOfObjectsAt(observations, "probes").map((probe) => ({
        method: stringAt(probe, "method"),
        pathTemplate: stringAt(probe, "path_template"),
        lastOk: typeof probe["last_ok"] === "boolean" ? probe["last_ok"] : null,
        lastProbeAt: nullableStringAt(probe, "last_probe_at"),
      })),
      logs: arrayOfObjectsAt(observations, "logs").map((log) => ({
        method: stringAt(log, "method"),
        pathTemplate: stringAt(log, "path_template"),
        lines: numberAt(log, "lines"),
        errorLines: numberAt(log, "error_lines"),
        lastObservedAt: nullableStringAt(log, "last_observed_at"),
      })),
    },
    raw: response,
  };
}

function normalizeEndpointHealthMetrics(
  response: Record<string, unknown>,
): EndpointHealthMetricsResponse {
  return {
    projectId: stringAt(response, "project_id"),
    window: stringAt(response, "window") as EndpointHealthMetricsResponse["window"],
    start: stringAt(response, "start"),
    end: stringAt(response, "end"),
    bucketSeconds: numberAt(response, "bucket_seconds"),
    total: numberAt(response, "total"),
    failed: numberAt(response, "failed"),
    errored: numberAt(response, "errored"),
    errorRate: numberAt(response, "error_rate"),
    passRate: typeof response["pass_rate"] === "number" ? response["pass_rate"] : null,
    p50Ms: numberAt(response, "p50_ms"),
    p95Ms: numberAt(response, "p95_ms"),
    p99Ms: numberAt(response, "p99_ms"),
    averageMs: numberAt(response, "avg_ms"),
    maxMs: numberAt(response, "max_ms"),
    lastRunAt: nullableStringAt(response, "last_run_at"),
    sparkline: arrayOfObjectsAt(response, "sparkline").map((point) => ({
      timestamp: stringAt(point, "ts"),
      runs: numberAt(point, "runs"),
      failures: numberAt(point, "failures"),
      p50Ms: numberAt(point, "p50_ms"),
      p95Ms: numberAt(point, "p95_ms"),
    })),
    raw: response,
  };
}

function normalizeEndpointDependencies(
  response: Record<string, unknown>,
): EndpointDependenciesResponse {
  const sources = objectAt(response, "sources");
  const normalizeNode = (node: Record<string, unknown>) => ({
    id: stringAt(node, "id"),
    name: stringAt(node, "name"),
    method: stringAt(node, "method"),
    host: stringAt(node, "host"),
    pathTemplate: stringAt(node, "path_template"),
  });
  return {
    projectId: stringAt(response, "project_id"),
    direction: "source_depends_on_target",
    edges: arrayOfObjectsAt(response, "edges").map((edge) => ({
      id: stringAt(edge, "id"),
      source: normalizeNode(objectAt(edge, "source")),
      target: normalizeNode(objectAt(edge, "target")),
      edgeType: stringAt(edge, "edge_type") as EndpointDependenciesResponse["edges"][number]["edgeType"],
      confidence: numberAt(edge, "confidence"),
      evidence: objectAt(edge, "evidence"),
    })),
    sources: {
      endpointEdges: numberAt(sources, "endpoint_edges"),
      collectionDeclarations: numberAt(sources, "collection_declarations"),
    },
    raw: response,
  };
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

function normalizePlatformToolResult(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function normalizeAppRecord(value: Record<string, unknown>): PremanAppRecord {
  const members = arrayOfObjectsAt(value, "members");
  return {
    ...(value as PremanAppRecord),
    id: stringAt(value, "id"),
    name: stringAt(value, "name"),
    slug: stringAt(value, "slug"),
    status: (stringAt(value, "status") || "active") as PremanAppRecord["status"],
    llmsTxtMarkdown: stringOrUndefined(value, "llms_txt_markdown") ?? stringOrUndefined(value, "llmsTxtMarkdown"),
    setupPlaybookJson: (value["setup_playbook_json"] ?? value["setupPlaybookJson"]) as AppPlaybookStep[] | undefined,
    templateKey: nullableStringAt(value, "template_key") ?? nullableStringAt(value, "templateKey"),
    members: members.length ? members.map(normalizeAppMember) : undefined,
  };
}

function normalizeAppMember(value: Record<string, unknown>) {
  return {
    ...(value as PremanAppMember),
    id: stringAt(value, "id"),
    prefix: stringAt(value, "prefix"),
    displayName: stringOrUndefined(value, "display_name") ?? stringOrUndefined(value, "displayName"),
    serverId: nullableStringAt(value, "server_id") ?? nullableStringAt(value, "serverId"),
    hostedMcpId: nullableStringAt(value, "hosted_mcp_id") ?? nullableStringAt(value, "hostedMcpId"),
  };
}

function normalizeAppSetupStatus(value: Record<string, unknown>): AppSetupStatus {
  const members = arrayOfObjectsAt(value, "members");
  return {
    appSlug: stringOrUndefined(value, "app_slug") ?? stringOrUndefined(value, "appSlug"),
    appName: stringOrUndefined(value, "app_name") ?? stringOrUndefined(value, "appName"),
    allMembersHealthy: booleanAt(value, "all_members_healthy") || booleanAt(value, "allMembersHealthy"),
    members: members.map((member) => ({
      prefix: stringAt(member, "prefix"),
      displayName: stringOrUndefined(member, "display_name") ?? stringOrUndefined(member, "displayName"),
      healthy: member["healthy"] === true,
      status: stringAt(member, "status") || "unknown",
      reconnectHint: nullableStringAt(member, "reconnect_hint") ?? nullableStringAt(member, "reconnectHint"),
      serverId: nullableStringAt(member, "server_id") ?? nullableStringAt(member, "serverId"),
      hostedMcpId: nullableStringAt(member, "hosted_mcp_id") ?? nullableStringAt(member, "hostedMcpId"),
    })),
    llmsTxtUrl: stringOrUndefined(value, "llms_txt_url") ?? stringOrUndefined(value, "llmsTxtUrl"),
    setupPlaybook: (value["setup_playbook"] ?? value["setupPlaybook"] ?? value["setup_playbook_json"]) as AppSetupStatus["setupPlaybook"],
  };
}

function normalizeAppInstallSnippet(value: Record<string, unknown>, slug: string, apiUrl = "https://api.preman.live"): AppInstallSnippet {
  if (!Object.keys(value).length) {
    return {
      url: appRuntimeUrl(apiUrl, slug),
      llmsTxtUrl: appLlmsTxtUrl(apiUrl, slug),
      mcp_json: {},
      mcpJson: {},
    };
  }
  const base = normalizeInstallSnippet(value);
  const llmsTxtUrl = stringOrUndefined(value, "llms_txt_url") ?? stringOrUndefined(value, "llmsTxtUrl");
  return {
    ...base,
    llmsTxtUrl: llmsTxtUrl ?? appLlmsTxtUrl(apiUrl, slug),
  };
}

function toBackendAppMember(member: import("./types.js").AppMemberInput): Record<string, unknown> {
  return omitUndefined({
    server_id: member.serverId ?? member.server_id,
    hosted_mcp_id: member.hostedMcpId ?? member.hosted_mcp_id,
    prefix: member.prefix,
    display_name: member.displayName ?? member.display_name,
  });
}

function stringOrUndefined(value: Record<string, unknown>, key: string): string | undefined {
  const item = value[key];
  return typeof item === "string" ? item : undefined;
}

function booleanAt(value: Record<string, unknown>, key: string): boolean {
  return value[key] === true;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
