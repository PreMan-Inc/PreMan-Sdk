import assert from "node:assert/strict";
import test from "node:test";
import { PremanAuthError, PremanClient, PremanConfigError, PremanError, verifyBearerToken } from "../dist/index.js";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("client rejects legacy OpenTest key prefixes", () => {
  assert.throws(
    () => new PremanClient({ apiKey: "ot_live_12345678901234567890123456789012" }),
    (error) => error instanceof PremanConfigError && /pm_live_/.test(error.message),
  );
});

test("registerEndpoints writes to an agent session", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    apiUrl: "https://api.preman.live",
    appUrl: "https://app.preman.live",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ id: "session_123", endpoint_count: 1 });
    },
  });

  const result = await client.registerEndpoints({
    sessionId: "session_123",
    upstreamBaseUrl: "https://api.example.com",
    intent: "Auth",
    endpoints: [
      {
        method: "POST",
        path: "/auth/login",
        requestBodySchema: {
          type: "object",
          properties: { email: { type: "string" } },
        },
      },
    ],
  });

  assert.equal(calls[0].url, "https://api.preman.live/agent-sessions/session_123/endpoints");
  assert.equal(JSON.parse(calls[0].init.body).endpoints[0].path_template, "/auth/login");
  assert.equal(result.dashboardUrl, "https://app.preman.live/try?session=session_123");
});

test("runSavedRequest encodes the request id and sends explicit one-run approval", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        id: "run_123",
        request_id: "request/with space?#",
        status: "failed",
        response_status: 503,
        latency_ms: 87,
        response_body: '{"error":"unavailable"}',
        error: null,
        method: "POST",
        url: "https://api.example.com/orders",
        created_at: "2026-08-14T12:34:56Z",
        assertions: [{
          kind: "status",
          expected: 201,
          actual: 503,
          passed: false,
        }],
        classification: "API_BUG",
        correlation_id: "pmr_123",
        pulse_run_id: "pulse_123",
      }, { status: 201 });
    },
  });

  const result = await client.runSavedRequest({
    requestId: "request/with space?#",
    workspaceId: "workspace_123",
    approveDestructive: true,
  });

  assert.equal(
    calls[0].url,
    "https://api.preman.live/workbench/requests/request%2Fwith%20space%3F%23/run",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { approveDestructive: true });
  assert.equal(calls[0].init.headers["X-Workspace-Id"], "workspace_123");
  assert.equal(result.id, "run_123");
  assert.equal(result.requestId, "request/with space?#");
  assert.equal(result.status, "failed");
  assert.equal(result.responseStatus, 503);
  assert.equal(result.latencyMs, 87);
  assert.equal(result.responseBody, '{"error":"unavailable"}');
  assert.equal(result.error, null);
  assert.equal(result.method, "POST");
  assert.equal(result.url, "https://api.example.com/orders");
  assert.equal(result.createdAt, "2026-08-14T12:34:56Z");
  assert.deepEqual(result.assertions[0], {
    kind: "status",
    expected: 201,
    actual: 503,
    passed: false,
    raw: {
      kind: "status",
      expected: 201,
      actual: 503,
      passed: false,
    },
  });
  assert.equal(result.classification, "API_BUG");
  assert.equal(result.correlationId, "pmr_123");
  assert.equal(result.pulseRunId, "pulse_123");
  assert.equal(result.raw.response_status, 503);
  assert.equal(result.raw.pulse_run_id, "pulse_123");
});

test("runSavedRequest omits optional approval and workspace data", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        id: "run_456",
        request_id: "request_456",
        status: "error",
      }, { status: 201 });
    },
  });

  const result = await client.runSavedRequest({ requestId: "request_456" });

  assert.equal("body" in calls[0].init, false);
  assert.equal(calls[0].init.headers["X-Workspace-Id"], undefined);
  assert.equal(result.responseStatus, null);
  assert.equal(result.latencyMs, null);
  assert.equal(result.responseBody, null);
  assert.equal(result.error, null);
  assert.deepEqual(result.assertions, []);
  assert.equal(result.classification, null);
  assert.equal(result.correlationId, null);
  assert.equal(result.pulseRunId, null);
});

test("configureEndpointProbe enables continuous endpoint testing with safe defaults", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        id: "probe_123",
        endpoint_id: "endpoint_123",
        enabled: true,
        interval_seconds: 60,
        timeout_seconds: 10,
        expected_status: 200,
        header_keys: ["Authorization"],
        has_custom_headers: true,
        method: "GET",
        path_template: "/health",
      });
    },
  });

  const result = await client.configureEndpointProbe({
    endpointId: "endpoint_123",
    expectedStatus: 200,
    headers: { Authorization: "Bearer secret" },
  });

  assert.equal(calls[0].url, "https://api.preman.live/monitoring/endpoints/endpoint_123/probe");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    enabled: true,
    interval_seconds: 60,
    timeout_seconds: 10,
    expected_status: 200,
    headers: { Authorization: "Bearer secret" },
    unattended_policy: "read_only",
  });
  assert.equal(result.endpointId, "endpoint_123");
  assert.deepEqual(result.headerKeys, ["Authorization"]);
});

test("createHealingRule turns native autofix on by default", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        id: "rule_123",
        name: "Self-heal failing endpoint",
        target_kind: "endpoint",
        target_id: "endpoint_123",
        rule_type: "consecutive_failures",
        threshold_failures: 3,
        min_samples: 5,
        channel_ids: [],
        enabled: true,
        autofix_enabled: true,
      });
    },
  });

  const result = await client.createHealingRule({ targetId: "endpoint_123" });
  assert.equal(calls[0].url, "https://api.preman.live/monitoring/alert-rules");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.target_kind, "endpoint");
  assert.equal(body.threshold_failures, 3);
  assert.equal(body.autofix_enabled, true);
  assert.equal(result.autofixEnabled, true);
});

test("startSelfHealing queues the native repair route", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        fix_task_id: "fix_123",
        dispatch: { provider: "native", stage: "queued", status: "dispatched" },
      });
    },
  });

  const result = await client.startSelfHealing({ fixTaskId: "fix_123" });
  assert.equal(calls[0].url, "https://api.preman.live/monitoring/fix-tasks/fix_123/autofix");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(result.dispatch.stage, "queued");
});

test("waitForSelfHealing resolves when repair validation is done", async () => {
  let calls = 0;
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        id: "fix_123",
        source_kind: "alert_event",
        source_id: "event_123",
        status: "open",
        package: {},
        dispatch_attempts: 1,
        dispatch_stage: calls === 1 ? "validating" : "done",
        pr_url: calls === 1 ? null : "https://github.com/acme/api/pull/42",
      });
    },
  });

  const result = await client.waitForSelfHealing({
    fixTaskId: "fix_123",
    pollIntervalMs: 0,
    timeoutMs: 100,
  });
  assert.equal(calls, 2);
  assert.equal(result.dispatchStage, "done");
  assert.equal(result.prUrl, "https://github.com/acme/api/pull/42");
});

test("Workbench investigation opens a durable chat and deterministic coding-agent task", async () => {
  const calls = [];
  const conversation = {
    id: "conversation_123",
    workspace_id: "workspace_123",
    title: "Investigate GET /health",
    archived: false,
    messages: [],
    created_at: "2026-08-14T12:00:00Z",
    updated_at: "2026-08-14T12:00:00Z",
  };
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) return jsonResponse(conversation, { status: 201 });
      return jsonResponse({
        fix_task: {
          id: "fix_123",
          workspace_id: "workspace_123",
          source_kind: "chat",
          source_id: "incident_123",
          status: "open",
          package: { kind: "chat_task" },
          dispatch_status: "running",
          dispatch_stage: "patching",
          dispatch_attempts: 1,
        },
        dispatch: { provider: "native", status: "running" },
        artifact: { type: "handoff", fix_task_id: "fix_123" },
        already_existed: false,
        conversation,
      });
    },
  });

  const created = await client.createWorkbenchConversation({
    title: "Investigate GET /health",
    workspaceId: "workspace_123",
  });
  const handoff = await client.createCodingAgentTask({
    title: "Investigate GET /health",
    instructions: "Use the captured failure, repair it, validate it, and open a review PR.",
    conversationId: created.id,
    workspaceId: "workspace_123",
    executionMode: "workspace_write",
  });

  assert.equal(calls[0].url, "https://api.preman.live/workbench/conversations");
  assert.equal(calls[0].init.headers["x-workspace-id"], "workspace_123");
  assert.deepEqual(JSON.parse(calls[0].init.body), { title: "Investigate GET /health" });
  assert.equal(calls[1].url, "https://api.preman.live/workbench/coding-agent/tasks");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    title: "Investigate GET /health",
    instructions: "Use the captured failure, repair it, validate it, and open a review PR.",
    conversation_id: "conversation_123",
    execution_mode: "workspace_write",
  });
  assert.equal(handoff.fixTask.dispatchStage, "patching");
  assert.equal(handoff.conversation.id, "conversation_123");
});

test("streamWorkbenchMessage emits typed SSE progress and returns the persisted turn", async () => {
  const encoder = new TextEncoder();
  const events = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"status","label":"Inspecting evidence"}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"delta","text":"Likely cause"}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"done","conversation":{"id":"conversation_123","workspace_id":"workspace_123","title":"Investigate GET /health","archived":false,"messages":[{"id":"message_1","role":"assistant","content":"Likely cause","artifacts":[],"created_at":"2026-08-14T12:00:01Z"}]},"turn":{"id":"message_1","role":"assistant","content":"Likely cause","artifacts":[],"created_at":"2026-08-14T12:00:01Z"}}\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } }),
  });

  const result = await client.streamWorkbenchMessage({
    conversationId: "conversation_123",
    content: "Investigate this endpoint failure.",
    onEvent: (event) => events.push(event.type),
  });

  assert.deepEqual(events, ["status", "delta", "done"]);
  assert.equal(result.conversation.id, "conversation_123");
  assert.equal(result.turn.content, "Likely cause");
});

test("deployMcp uses the hosted MCP deploy route and normalizes response", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        hosted_mcp: { id: "mcp_123", name: "Auth MCP" },
        hosted_mcp_url: "https://api.preman.live/h/mcp_123/mcp",
        tool_count: 1,
        raw_consumer_token: "pm_hmcp_test",
        consumer_token: { id: "token_123" },
        install_snippet: {
          url: "https://api.preman.live/h/mcp_123/mcp",
          mcp_json: { mcpServers: {} },
        },
      });
    },
  });

  const result = await client.deployMcp({
    sessionId: "session_123",
    name: "Auth MCP",
    upstreamBaseUrl: "https://api.example.com",
    endpoints: [{ method: "POST", path: "/auth/login" }],
  });

  assert.equal(calls[0].url, "https://api.preman.live/agent-sessions/session_123/mcp/deploy");
  assert.equal(JSON.parse(calls[0].init.body).initial_consumer_label, "default-consumer");
  assert.equal(result.mcpId, "mcp_123");
  assert.equal(result.hostedUrl, "https://api.preman.live/h/mcp_123/mcp");
  assert.equal(result.dashboardUrl, "https://app.preman.live/hosted-mcps/mcp_123");
});

test("getCapabilities falls back when API route is missing", async () => {
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async () => new Response("not found", { status: 404 }),
  });
  const caps = await client.getCapabilities();
  assert.equal(caps.upstreamHosting.supported, false);
  assert.deepEqual(caps.upstreamHosting.modes, ["external"]);
});

test("getCapabilities normalizes preman upstream hosting", async () => {
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://api.preman.live/capabilities");
      return jsonResponse({
        upstream_hosting: {
          supported: true,
          modes: ["external", "preman"],
          default_mode: "preman",
          supports_dockerfile_build: true,
        },
      });
    },
  });
  const caps = await client.getCapabilities();
  assert.equal(caps.upstreamHosting.supported, true);
  assert.equal(caps.upstreamHosting.defaultMode, "preman");
});

test("startGithubInstall returns the one-click GitHub App authorization URL", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ install_url: "https://github.com/apps/preman/installations/new?state=safe" });
    },
  });

  const result = await client.startGithubInstall();
  assert.equal(calls[0].url, "https://api.preman.live/integrations/github/app/install");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(result.install_url, "https://github.com/apps/preman/installations/new?state=safe");
  assert.equal(result.mode, undefined);
  assert.equal(result.installations, undefined);
});

test("startGithubInstall exposes existing installations without breaking the old response", async () => {
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async () => jsonResponse({
      install_url: "https://github.com/apps/preman/installations/new?state=safe",
      mode: "configure",
      installations: [{
        account_login: "PreMan-Inc",
        configure_url: "https://github.com/organizations/PreMan-Inc/settings/installations/91",
      }],
    }),
  });

  const result = await client.startGithubInstall();
  assert.equal(result.mode, "configure");
  assert.equal(result.installations[0].account_login, "PreMan-Inc");
});

test("refreshGithubInstallations sends a bodyless POST and returns reconciliation counts", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        installations_refreshed: 1,
        repositories_connected: 2,
        repositories_deactivated: 3,
      });
    },
  });

  const result = await client.refreshGithubInstallations();
  assert.equal(calls[0].url, "https://api.preman.live/integrations/github/app/refresh");
  assert.equal(calls[0].init.method, "POST");
  assert.equal("body" in calls[0].init, false);
  assert.deepEqual(result, {
    installations_refreshed: 1,
    repositories_connected: 2,
    repositories_deactivated: 3,
  });
});

test("refreshGithubInstallations preserves API error status and code", async () => {
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async () => jsonResponse(
      { detail: { code: "github_app_not_connected", message: "Connect the GitHub App first." } },
      { status: 409 },
    ),
  });

  await assert.rejects(
    () => client.refreshGithubInstallations(),
    (error) => error instanceof PremanError
      && error.status === 409
      && error.body.detail.code === "github_app_not_connected",
  );
});

test("listGithubIntegrations exposes safe GitHub App metadata", async () => {
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "https://api.preman.live/integrations/github");
      assert.equal(init.method, "GET");
      return jsonResponse([{
        id: "integration_123",
        repo_url: "https://github.com/preman-inc/preman-backend",
        auto_pr_enabled: true,
        simulate_on_push: true,
        webhook_configured: true,
        webhook_url: "https://api.preman.live/webhooks/github",
        github_installation_id: 42,
        credential_kind: "github_app",
        github_account_login: "preman-inc",
      }]);
    },
  });

  const integrations = await client.listGithubIntegrations();
  assert.equal(integrations[0].credential_kind, "github_app");
  assert.equal(integrations[0].github_account_login, "preman-inc");
  assert.equal("access_token" in integrations[0], false);
});

test("removeGithubIntegration sends an encoded DELETE and returns cleanup counts", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        ok: true,
        integration_id: "integration/id",
        endpoints_deactivated: 12,
      });
    },
  });

  const result = await client.removeGithubIntegration("integration/id");
  assert.equal(
    calls[0].url,
    "https://api.preman.live/integrations/github/integration%2Fid",
  );
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal("body" in calls[0].init, false);
  assert.deepEqual(result, {
    ok: true,
    integration_id: "integration/id",
    endpoints_deactivated: 12,
  });
});

test("getFixTask normalizes bounded safe agent activity and preserves the raw result", async () => {
  const activity = [
    { id: "inspect", label: "Inspecting API routes", state: "complete", elapsed_ms: 420 },
    { id: "patch", label: "Updating compatibility handler", state: "active" },
    { id: "invalid", label: "Hidden invalid state", state: "thinking" },
    { id: "inspect", label: "Duplicate activity", state: "active" },
    { id: "bad id", label: "Unsafe id", state: "active" },
    { id: "controls", label: "Running\u0000  tests", state: "complete" },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `extra-${index}`,
      label: `Safe activity ${index}`,
      state: "complete",
    })),
  ];
  const dispatchResult = {
    progress: { message: "Repairing", activity },
    summary: "Compatibility repair underway",
  };
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async () => jsonResponse({
      id: "fix_123",
      source_kind: "chat",
      source_id: "simulation_123",
      status: "delivered",
      package: {},
      dispatch_result: dispatchResult,
      dispatch_attempts: 1,
    }),
  });

  const task = await client.getFixTask("fix_123");

  assert.deepEqual(task.dispatchResult, dispatchResult);
  assert.equal(task.dispatchProgress.message, "Repairing");
  assert.deepEqual(task.dispatchProgress.activity[0], {
    id: "inspect",
    label: "Inspecting API routes",
    state: "complete",
    elapsed_ms: 420,
  });
  assert.equal(task.dispatchActivity.length, 6);
  assert.deepEqual(task.dispatchActivity[0], {
    id: "inspect",
    label: "Inspecting API routes",
    state: "complete",
    elapsedMs: 420,
  });
  assert.deepEqual(task.dispatchActivity[1], {
    id: "patch",
    label: "Updating compatibility handler",
    state: "active",
  });
  assert.equal(task.dispatchActivity.some((item) => item.id === "invalid"), false);
  assert.equal(task.dispatchActivity.some((item) => item.label === "Duplicate activity"), false);
  assert.equal(task.dispatchActivity.some((item) => item.id === "bad id"), false);
  assert.equal(task.dispatchActivity.find((item) => item.id === "controls")?.label, "Running tests");
});

test("getFixTask keeps legacy scalar progress backward compatible", async () => {
  const dispatchResult = { progress: "Agent is working" };
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async () => jsonResponse({
      id: "fix_legacy",
      source_kind: "chat",
      source_id: "simulation_legacy",
      status: "open",
      package: {},
      dispatch_result: dispatchResult,
      dispatch_attempts: 0,
    }),
  });

  const task = await client.getFixTask("fix_legacy");

  assert.deepEqual(task.dispatchResult, dispatchResult);
  assert.equal(task.dispatchProgress, null);
  assert.deepEqual(task.dispatchActivity, []);
});

test("handoffGithubSimulation returns the durable repair conversation", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        fix_task: {
          id: "fix_123",
          source_kind: "chat",
          source_id: "simulation_123",
          status: "delivered",
          package: {},
          dispatch_result: {
            progress: {
              activity: [{ id: "inspect", label: "Inspecting API routes", state: "active" }],
            },
          },
          dispatch_attempts: 1,
        },
        dispatch: { run_id: "agent_run_123", status: "queued" },
        artifact: { type: "handoff", fix_task_id: "fix_123" },
        already_existed: false,
        conversation: {
          id: "conversation_123",
          workspace_id: "workspace_789",
          title: "Repair API contract changes in ced99ad1",
          archived: false,
          task_in_progress: true,
          created_at: "2026-08-13T12:00:00Z",
          updated_at: "2026-08-13T12:00:01Z",
          messages: [{
            id: "message_123",
            role: "assistant",
            content: "Dispatched to Codex.",
            artifacts: [{ type: "handoff", fix_task_id: "fix_123" }],
            provider: "openai",
            model: "gpt-5",
            created_at: "2026-08-13T12:00:01Z",
          }],
        },
      });
    },
  });

  const result = await client.handoffGithubSimulation({
    integrationId: "integration/123",
    runId: "run/456",
    workspaceId: "workspace_789",
  });

  assert.equal(
    calls[0].url,
    "https://api.preman.live/integrations/github/integration%2F123/simulations/run%2F456/handoff",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal("body" in calls[0].init, false);
  assert.equal(calls[0].init.headers["x-workspace-id"], "workspace_789");
  assert.equal(result.conversation.id, "conversation_123");
  assert.equal(result.conversation.workspaceId, "workspace_789");
  assert.equal(result.conversation.taskInProgress, true);
  assert.equal(result.conversation.messages[0].createdAt, "2026-08-13T12:00:01Z");
  assert.equal(result.conversation.messages[0].artifacts[0].fix_task_id, "fix_123");
  assert.equal(result.fixTask.dispatchActivity[0].label, "Inspecting API routes");
  assert.equal(result.raw.conversation.id, "conversation_123");
});

test("handoffGithubSimulation tolerates an older response without a conversation", async () => {
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async () => jsonResponse({
      fix_task: { id: "fix_123" },
      dispatch: null,
      artifact: { type: "handoff" },
      already_existed: true,
    }),
  });

  const result = await client.handoffGithubSimulation({
    integrationId: "integration_123",
    runId: "run_456",
  });

  assert.equal(result.conversation, null);
  assert.equal(result.alreadyExisted, true);
});

test("listGithubCommits uses the server-managed connection and forwards request options", async () => {
  const sha = "a".repeat(40);
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      assert.equal(
        String(url),
        "https://api.preman.live/integrations/github/integration%2Fid/commits?limit=6",
      );
      assert.equal(init.method, "GET");
      assert.equal(init.headers["X-Workspace-Id"], "workspace_123");
      return jsonResponse({
        branch: "main",
        commits: [{
          sha,
          message: "Protect customer sessions",
          author_name: "Alice",
          authored_at: "2026-08-11T19:00:00Z",
          html_url: `https://github.com/acme/api/commit/${sha}`,
        }],
      });
    },
  });

  const result = await client.listGithubCommits({
    integrationId: "integration/id",
    limit: 6,
    request: { headers: { "X-Workspace-Id": "workspace_123" } },
  });
  assert.equal(result.branch, "main");
  assert.equal(result.commits[0].sha, sha);
});

test("listGithubSimulations sends pagination and returns the typed run envelope", async () => {
  const sha = "b".repeat(40);
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      assert.equal(
        String(url),
        "https://api.preman.live/integrations/github/integration_123/simulations?limit=5&offset=10",
      );
      assert.equal(init.method, "GET");
      return jsonResponse({
        runs: [{
          id: "run_123",
          integration_id: "integration_123",
          status: "queued",
          trigger: "manual",
          ref: "refs/heads/main",
          branch: "main",
          commit_sha: sha,
          before_sha: null,
          simulation_mode: "contract_synthetic",
          baseline_commit_sha: null,
          github_delivery_id: null,
          attempt_count: 0,
          summary: {},
          steps: [],
          error: null,
          created_at: "2026-08-12T12:00:00Z",
          started_at: null,
          finished_at: null,
        }],
        total: 11,
        limit: 5,
        offset: 10,
      });
    },
  });

  const result = await client.listGithubSimulations({
    integrationId: "integration_123",
    limit: 5,
    offset: 10,
  });
  assert.equal(result.total, 11);
  assert.equal(result.runs[0].commit_sha, sha);
});

test("getGithubSimulation returns signed webhook identity and terminal runtime evidence", async () => {
  const sha = "d".repeat(40);
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      assert.equal(
        String(url),
        "https://api.preman.live/integrations/github/integration%2Fid/simulations/run%2Fid",
      );
      assert.equal(init.method, "GET");
      return jsonResponse({
        id: "run/id",
        integration_id: "integration/id",
        status: "succeeded",
        trigger: "webhook",
        ref: "refs/heads/main",
        branch: "main",
        commit_sha: sha,
        before_sha: "c".repeat(40),
        simulation_mode: "contract_synthetic",
        baseline_commit_sha: "c".repeat(40),
        github_delivery_id: "delivery-123",
        attempt_count: 1,
        summary: {
          verdict: "green",
          changes_total: 1,
          baseline: {
            commit_sha: "c".repeat(40),
            branch: "main",
            endpoint_count: 12,
            location: "repo endpoint inventory",
            status: "current",
          },
          impact: [
            {
              change_type: "modified",
              method: "POST",
              path: "/v1/login",
              file: "routes/auth.py",
              contract_diff: [
                {
                  field: "response_schema.properties.token.type",
                  before: "string",
                  after: "integer",
                  before_present: true,
                  after_present: true,
                  before_truncated: false,
                  after_truncated: false,
                },
              ],
              contract_diff_truncated: false,
            },
          ],
          evidence: {
            runtime: {
              planned: 1,
              executed: 1,
              passed: 1,
              failed: 0,
              unavailable: 0,
              coverage_complete: true,
              candidate_verified: true,
              attestation: { verified: 1, missing: 0, mismatched: 0 },
            },
          },
        },
        runtime_scenarios: [
          {
            id: "probe-1",
            kind: "probe",
            name: "GET /health",
            scenario_type: null,
            method: "GET",
            path: "/health",
            outcome: "passed",
            response_status: 200,
            latency_ms: 18,
            failure_reason: null,
            build_attestation: "verified",
          },
        ],
        steps: [],
        error: null,
        created_at: "2026-08-12T12:00:00Z",
        started_at: "2026-08-12T12:00:01Z",
        finished_at: "2026-08-12T12:00:02Z",
      });
    },
  });

  const result = await client.getGithubSimulation({
    integrationId: "integration/id",
    runId: "run/id",
  });
  assert.equal(result.trigger, "webhook");
  assert.equal(result.github_delivery_id, "delivery-123");
  assert.equal(result.status, "succeeded");
  assert.equal(result.finished_at, "2026-08-12T12:00:02Z");
  assert.equal(result.summary.evidence.runtime.attestation.verified, 1);
  assert.equal(result.summary.baseline.commit_sha, "c".repeat(40));
  assert.equal(result.summary.baseline.location, "repo endpoint inventory");
  assert.deepEqual(result.summary.impact[0].contract_diff[0], {
    field: "response_schema.properties.token.type",
    before: "string",
    after: "integer",
    before_present: true,
    after_present: true,
    before_truncated: false,
    after_truncated: false,
  });
  assert.deepEqual(result.runtime_scenarios[0], {
    id: "probe-1",
    kind: "probe",
    name: "GET /health",
    scenario_type: null,
    method: "GET",
    path: "/health",
    outcome: "passed",
    response_status: 200,
    latency_ms: 18,
    failure_reason: null,
    build_attestation: "verified",
  });
});

test("getLatestWorkspaceGithubSimulation scopes the signed-push receipt automatically", async () => {
  const sha = "e".repeat(40);
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      assert.equal(
        String(url),
        "https://api.preman.live/integrations/github/workspace-simulation/latest",
      );
      assert.equal(init.method, "GET");
      assert.equal(init.headers["X-Workspace-Id"], "workspace_123");
      assert.equal(init.headers["X-Correlation-Id"], "correlation_123");
      return jsonResponse({
        integration: {
          id: "integration_123",
          workspace_id: "workspace_123",
          repo_url: "https://github.com/acme/api",
        },
        run: {
          id: "run_123",
          integration_id: "integration_123",
          status: "queued",
          trigger: "webhook",
          ref: "refs/heads/main",
          branch: "main",
          commit_sha: sha,
          before_sha: null,
          simulation_mode: "contract_synthetic",
          baseline_commit_sha: null,
          github_delivery_id: "delivery-123",
          attempt_count: 0,
          summary: {},
          steps: [],
          error: null,
          created_at: "2026-08-12T12:00:00Z",
          started_at: null,
          finished_at: null,
        },
      });
    },
  });

  const result = await client.getLatestWorkspaceGithubSimulation({
    workspaceId: "workspace_123",
    request: { headers: { "X-Correlation-Id": "correlation_123" } },
  });
  assert.equal(result.run.trigger, "webhook");
  assert.equal(result.run.github_delivery_id, "delivery-123");
});

test("GitHub simulation policy methods map the typed evidence contract", async () => {
  const calls = [];
  const connectorId = "00000000-0000-4000-8000-000000000001";
  const policy = {
    integration_id: "integration_123",
    requested_mode: "observed_behavior",
    effective_mode: "observed_behavior",
    observation_window_days: 14,
    fallback_policy: "require_observed",
    log_connector_id: connectorId,
    eligibility: {
      eligible: true,
      reason_code: null,
      message: "CloudWatch evidence is ready.",
      project_id: "project_123",
      sources: [{
        id: connectorId,
        name: "Production logs",
        type: "cloudwatch",
        enabled: true,
        healthy: true,
        last_success_at: "2026-08-12T12:00:00Z",
        last_observed_at: "2026-08-12T11:59:00Z",
        lines_ingested_total: 42,
        interval_seconds: 300,
        selected: true,
      }],
    },
    privacy: {
      redacted_before_persistence: true,
      raw_requests_replayed: false,
      aggregate_only: true,
      k_anonymity_minimum: null,
      minimum_distinct_requests: 5,
      anonymity_claim: "not_claimed",
      maximum_scenarios: 50,
      cohort_and_journey_labels: "server_secret_hmac_sha256_v1",
      client_versions: "major_minor_bucket",
      excluded_raw_fields: ["body", "headers"],
    },
    baseline: {
      storage: "endpoint_definitions",
      location: "repo endpoint inventory",
      commit_sha: "f".repeat(40),
      branch: "main",
      published_at: "2026-08-12T12:00:00Z",
      endpoint_count: 4,
      status: "current",
    },
  };
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse(policy);
    },
  });

  const current = await client.getGithubSimulationPolicy({ integrationId: "integration/id" });
  const changed = await client.updateGithubSimulationPolicy({
    integrationId: "integration/id",
    requestedMode: "observed_behavior",
    observationWindowDays: 14,
    fallbackPolicy: "require_observed",
    logConnectorId: connectorId,
  });

  assert.equal(
    calls[0].url,
    "https://api.preman.live/integrations/github/integration%2Fid/simulation-policy",
  );
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    requested_mode: "observed_behavior",
    observation_window_days: 14,
    fallback_policy: "require_observed",
    log_connector_id: connectorId,
  });
  assert.equal(current.eligibility.sources[0].healthy, true);
  assert.equal(changed.baseline.status, "current");

  await assert.rejects(
    () => client.updateGithubSimulationPolicy({ integrationId: "integration_123" }),
    (error) => error instanceof PremanConfigError && /at least one/.test(error.message),
  );
  assert.equal(calls.length, 2);
});

test("startGithubSimulation maps ref and commitSha without exposing GitHub credentials", async () => {
  const calls = [];
  const sha = "c".repeat(40);
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        id: "run_123",
        integration_id: "integration_123",
        status: "queued",
        trigger: "manual",
        ref: "refs/heads/main",
        branch: "main",
        commit_sha: sha,
        before_sha: null,
        simulation_mode: "contract_synthetic",
        baseline_commit_sha: null,
        github_delivery_id: null,
        attempt_count: 0,
        summary: {},
        steps: [],
        error: null,
        created_at: "2026-08-12T12:00:00Z",
        started_at: null,
        finished_at: null,
      });
    },
  });

  const result = await client.startGithubSimulation({
    integrationId: "integration_123",
    ref: "refs/heads/main",
    commitSha: sha,
  });
  assert.equal(calls[0].url, "https://api.preman.live/integrations/github/integration_123/simulations");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    ref: "refs/heads/main",
    commit_sha: sha,
  });
  assert.equal("token" in JSON.parse(calls[0].init.body), false);
  assert.equal(result.commit_sha, sha);
});

test("startGithubSimulation keeps the default run bodyless and validates selected SHAs", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({});
    },
  });

  await client.startGithubSimulation({ integrationId: "integration_123" });
  assert.equal("body" in calls[0].init, false);
  await assert.rejects(
    () => client.startGithubSimulation({ integrationId: "integration_123", commitSha: "short" }),
    (error) => error instanceof PremanConfigError && /40-character/.test(error.message),
  );
  assert.equal(calls.length, 1);
});

test("deployMcp sends preman upstream hosting fields", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        hosted_mcp: { id: "mcp_123", name: "Spotify MCP", upstream_mode: "preman" },
        hosted_mcp_url: "https://api.preman.live/h/mcp_123/mcp",
        tool_count: 5,
        upstream_mode: "preman",
        upstream_hosting: {
          upstream_mode: "preman",
          status: "building",
          build_id: "build_1",
        },
      });
    },
  });

  const result = await client.deployMcp({
    name: "Spotify MCP",
    upstreamMode: "preman",
    upstreamBuild: { dockerfile: "Dockerfile" },
    endpoints: [{ method: "POST", path: "/tools/playback" }],
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.upstream_mode, "preman");
  assert.equal(body.upstream_build.dockerfile, "Dockerfile");
  assert.equal(body.upstream_base_url, undefined);
  assert.equal(result.upstreamMode, "preman");
  assert.equal(result.upstreamHosting?.status, "building");
});

test("importFromDocs creates a hosted MCP from a docs URL", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        hosted_mcp: { id: "mcp_docs", name: "Docs MCP" },
        hosted_mcp_url: "https://api.preman.live/h/mcp_docs/mcp",
        install_snippet: {
          url: "https://api.preman.live/h/mcp_docs/mcp",
          mcp_json: { mcpServers: {} },
        },
        preview: { source_type: "openapi", tool_count: 12 },
        generated_spec: { tools: [{ name: "get_users" }] },
        notice: "Created from OpenAPI/Swagger discovered from the docs URL.",
      });
    },
  });

  const result = await client.importFromDocs({
    docsUrl: "https://docs.example.com/api",
    name: "Docs MCP",
    upstreamBaseUrl: "https://api.example.com",
    maxEndpoints: 120,
    accessMode: "token",
    deploy: true,
  });

  assert.equal(calls[0].url, "https://api.preman.live/hosted-mcps/import-from-docs");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    docs_url: "https://docs.example.com/api",
    name: "Docs MCP",
    upstream_base_url: "https://api.example.com",
    access_mode: "token",
    max_endpoints: 120,
    deploy: true,
  });
  assert.equal(result.mcpId, "mcp_docs");
  assert.equal(result.hostedUrl, "https://api.preman.live/h/mcp_docs/mcp");
  assert.equal(result.dashboardUrl, "https://app.preman.live/hosted-mcps/mcp_docs");
  assert.equal(result.preview.tool_count, 12);
  assert.equal(result.generatedSpec.tools[0].name, "get_users");
});

test("importRemoteMcp creates a gateway proxy for an existing MCP server", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        hosted_mcp: { id: "mcp_remote", name: "Remote MCP Proxy" },
        hosted_mcp_url: "https://api.preman.live/h/mcp_remote/mcp",
        install_snippet: {
          url: "https://api.preman.live/h/mcp_remote/mcp",
          mcp_json: { mcpServers: {} },
        },
        preview: { source_type: "remote_mcp", tool_count: 3 },
        generated_spec: { proxy_type: "remote_mcp" },
      });
    },
  });

  const result = await client.importRemoteMcp({
    mcpUrl: "https://remote.example.com/mcp",
    name: "Remote MCP Proxy",
    upstreamAuthStyle: { type: "header", name: "Authorization", prefix: "Bearer " },
    initialUpstreamSecret: "remote-secret",
    initialUpstreamSecretType: "bearer",
  });

  assert.equal(calls[0].url, "https://api.preman.live/hosted-mcps/import-remote-mcp");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    mcp_url: "https://remote.example.com/mcp",
    name: "Remote MCP Proxy",
    upstream_auth_style: { type: "header", name: "Authorization", prefix: "Bearer " },
    initial_upstream_secret: "remote-secret",
    initial_upstream_secret_type: "bearer",
  });
  assert.equal(result.mcpId, "mcp_remote");
  assert.equal(result.generatedSpec.proxy_type, "remote_mcp");
});

test("createLocalStdioTunnel registers local STDIO metadata without sending env values", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        tunnel_id: "tun_123",
        hosted_mcp: { id: "mcp_stdio", name: "Local Files MCP" },
        hosted_mcp_url: "https://api.preman.live/h/mcp_stdio/mcp",
        local_stdio: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
          cwd: "/workspace",
          env_names: ["FILESYSTEM_ROOT"],
        },
        install_snippet: {
          url: "https://api.preman.live/h/mcp_stdio/mcp",
          mcp_json: { mcpServers: {} },
        },
      });
    },
  });

  const result = await client.createLocalStdioTunnel({
    name: "Local Files MCP",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    cwd: "/workspace",
    envNames: ["FILESYSTEM_ROOT"],
    scopes: ["files:read"],
    accessMode: "token",
  });

  assert.equal(calls[0].url, "https://api.preman.live/hosted-mcps/local-stdio-tunnels");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    name: "Local Files MCP",
    local_stdio: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      cwd: "/workspace",
      env_names: ["FILESYSTEM_ROOT"],
    },
    access_mode: "token",
    scopes: ["files:read"],
  });
  assert.equal(result.tunnelId, "tun_123");
  assert.equal(result.mcpId, "mcp_stdio");
  assert.equal(result.dashboardUrl, "https://app.preman.live/hosted-mcps/mcp_stdio");
  assert.deepEqual(result.localStdio.envNames, ["FILESYSTEM_ROOT"]);
});

test("local STDIO tunnel poll and response methods map message routes", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/poll")) {
        return jsonResponse({
          messages: [
            {
              id: "msg_1",
              message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
              received_at: "2026-06-10T00:00:00Z",
            },
          ],
        });
      }
      return jsonResponse({});
    },
  });

  const polled = await client.pollLocalStdioTunnelMessages({ tunnelId: "tun_123", waitMs: 500 });
  await client.sendLocalStdioTunnelMessage({
    tunnelId: "tun_123",
    message: { jsonrpc: "2.0", id: 1, result: { tools: [] } },
  });
  await client.updateLocalStdioTunnelStatus({
    tunnelId: "tun_123",
    status: "connected",
  });

  assert.equal(calls[0].url, "https://api.preman.live/hosted-mcps/local-stdio-tunnels/tun_123/poll");
  assert.deepEqual(JSON.parse(calls[0].init.body), { wait_ms: 500 });
  assert.equal(polled.messages[0].id, "msg_1");
  assert.deepEqual(polled.messages[0].message, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(calls[1].url, "https://api.preman.live/hosted-mcps/local-stdio-tunnels/tun_123/messages");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    message: { jsonrpc: "2.0", id: 1, result: { tools: [] } },
  });
  assert.equal(calls[2].url, "https://api.preman.live/hosted-mcps/local-stdio-tunnels/tun_123/status");
  assert.deepEqual(JSON.parse(calls[2].init.body), { status: "connected" });
});

test("listHostedMcps and getHostedMcp read hosted MCP inventory", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/hosted-mcps/mcp_123")) {
        return jsonResponse({ hosted_mcp: { id: "mcp_123", name: "Auth MCP" } });
      }
      return jsonResponse({ hosted_mcps: [{ id: "mcp_123", name: "Auth MCP" }], total: 1 });
    },
  });

  const listed = await client.listHostedMcps();
  const detail = await client.getHostedMcp("mcp_123");

  assert.equal(calls[0].url, "https://api.preman.live/hosted-mcps");
  assert.equal(calls[1].url, "https://api.preman.live/hosted-mcps/mcp_123");
  assert.equal(listed.total, 1);
  assert.equal(listed.hostedMcps[0].name, "Auth MCP");
  assert.equal(detail.hostedMcp.id, "mcp_123");
});

test("createToken maps SDK token options to hosted MCP consumer tokens", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        raw_token: "pm_hmcp_test",
        token: { id: "token_123", expires_at: null },
        install_snippet: {
          url: "https://api.preman.live/h/mcp_123/mcp",
          mcp_json: { mcpServers: {} },
        },
      });
    },
  });

  const result = await client.createToken({
    mcpId: "mcp_123",
    consumerLabel: "Acme",
    scopes: ["auth:login"],
    rateLimitRpm: 60,
  });

  assert.equal(calls[0].url, "https://api.preman.live/hosted-mcps/mcp_123/tokens");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    consumer_label: "Acme",
    scopes: ["auth:login"],
    rate_limit_rpm: 60,
  });
  assert.equal(result.token, "pm_hmcp_test");
  assert.equal(result.tokenId, "token_123");
});

test("verifyToken posts to the hosted MCP verification endpoint and normalizes identity", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        valid: true,
        scopes: ["auth:login"],
        token_id: "token_123",
        expires_at: "2026-05-10T12:00:00Z",
        identity: {
          agent_id: "agent_123",
          customer_id: "customer_123",
        },
      });
    },
  });

  const result = await client.verifyToken({
    mcpId: "mcp_123",
    token: "pm_hmcp_test",
    requiredScope: "auth:login",
  });

  assert.equal(calls[0].url, "https://api.preman.live/hosted-mcps/mcp_123/tokens/verify");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    token: "pm_hmcp_test",
    required_scope: "auth:login",
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.scopes, ["auth:login"]);
  assert.deepEqual(result.identity, {
    tokenId: "token_123",
    agentId: "agent_123",
    customerId: "customer_123",
  });
  assert.equal(result.tokenId, "token_123");
  assert.equal(result.expiresAt, "2026-05-10T12:00:00Z");
});

test("verifyToken rejects invalid verification responses with a helpful error", async () => {
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async () => jsonResponse({ scopes: ["auth:login"] }),
  });

  await assert.rejects(
    () => client.verifyToken({ mcpId: "mcp_123", token: "pm_hmcp_test" }),
    (error) => error instanceof PremanError && /expected boolean `valid` field/.test(error.message),
  );
});

test("verifyBearerToken requires mcpId and returns identity", async () => {
  const headers = { authorization: "Bearer pm_hmcp_test" };
  const client = {
    verifyToken: async () => ({
      valid: true,
      scopes: ["auth:login"],
      identity: {
        tokenId: "token_123",
        agentId: "agent_123",
        customerId: "customer_123",
      },
    }),
  };

  await assert.rejects(
    () => verifyBearerToken(headers, { client, mcpId: "", requiredScope: "auth:login" }),
    (error) => error instanceof PremanAuthError && /mcpId is required/.test(error.message),
  );

  const result = await verifyBearerToken(headers, {
    client,
    mcpId: "mcp_123",
    requiredScope: "auth:login",
  });

  assert.deepEqual(result.identity, {
    tokenId: "token_123",
    agentId: "agent_123",
    customerId: "customer_123",
  });
  assert.equal(result.tokenId, "token_123");
});

test("audit posts custom events and normalizes response", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ id: "audit_123", created_at: "2026-05-10T12:00:00Z" });
    },
  });

  const result = await client.audit({
    agentId: "agent_123",
    customerId: "cus_123",
    action: "auth.login",
    resource: "user:123",
    outcome: "success",
    metadata: { ip: "127.0.0.1" },
  });

  assert.equal(calls[0].url, "https://api.preman.live/audit/events");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer pm_live_12345678901234567890123456789012");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    agent_id: "agent_123",
    customer_id: "cus_123",
    action: "auth.login",
    resource: "user:123",
    outcome: "success",
    metadata: { ip: "127.0.0.1" },
  });
  assert.deepEqual(result, {
    id: "audit_123",
    createdAt: "2026-05-10T12:00:00Z",
  });
});

test("client defaults to PreMan API and app URLs", async () => {
  const previous = process.env.PREMAN_API_KEY;
  process.env.PREMAN_API_KEY = "pm_live_12345678901234567890123456789012";
  try {
    const client = new PremanClient({
      fetchImpl: async () => jsonResponse({ id: "session_123", endpoint_count: 0 }),
    });
    assert.equal(client.apiUrl, "https://api.preman.live");
    assert.equal(client.appUrl, "https://app.preman.live");
  } finally {
    if (previous === undefined) {
      delete process.env.PREMAN_API_KEY;
    } else {
      process.env.PREMAN_API_KEY = previous;
    }
  }
});

test("client retries idempotent POST requests and emits hooks", async () => {
  const events = [];
  let count = 0;
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    retry: { retries: 1, initialDelayMs: 1, maxDelayMs: 1 },
    hooks: {
      onRequest: (event) => events.push(["request", event.attempt, event.idempotencyKey]),
      onResponse: (event) => events.push(["response", event.status]),
      onError: (event) => events.push(["error", event.status]),
    },
    fetchImpl: async () => {
      count += 1;
      if (count === 1) {
        return new Response(JSON.stringify({ detail: "temporary" }), { status: 503 });
      }
      return jsonResponse({
        raw_token: "pm_hmcp_test",
        token: { id: "token_123" },
        install_snippet: { url: "https://api.preman.live/h/mcp_123/mcp", mcp_json: {} },
      });
    },
  });

  const result = await client.createToken({
    mcpId: "mcp_123",
    consumerLabel: "agent",
    scopes: ["auth:login"],
    request: { idempotencyKey: "idem_123" },
  });

  assert.equal(result.tokenId, "token_123");
  assert.equal(count, 2);
  assert.deepEqual(events.map((event) => event[0]), ["request", "response", "error", "request", "response"]);
});

test("token list revoke and rotate use hosted MCP token lifecycle endpoints", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/tokens?include_revoked=true")) {
        return jsonResponse({ tokens: [{ id: "token_old", consumer_label: "agent", scopes: ["auth:login"] }] });
      }
      if (init.method === "DELETE") {
        return jsonResponse({ revoked: true, token_id: "token_old" });
      }
      return jsonResponse({
        raw_token: "pm_hmcp_new",
        token: { id: "token_new" },
        install_snippet: { url: "https://api.preman.live/h/mcp_123/mcp", mcp_json: {} },
      });
    },
  });

  const listed = await client.listTokens({ mcpId: "mcp_123", includeRevoked: true });
  const rotated = await client.rotateToken({
    mcpId: "mcp_123",
    tokenId: "token_old",
    scopes: ["auth:login"],
    consumerLabel: "agent",
  });

  assert.equal(listed.tokens[0].id, "token_old");
  assert.equal(rotated.newToken.tokenId, "token_new");
  assert.equal(rotated.revoked.tokenId, "token_old");
  assert.equal(calls[0].url, "https://api.preman.live/hosted-mcps/mcp_123/tokens?include_revoked=true");
  assert.equal(calls[2].init.method, "DELETE");
});

test("deployMcp forwards upstream OAuth provider config", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        hosted_mcp: { id: "mcp_spotify", name: "Spotify MCP" },
        hosted_mcp_url: "https://api.preman.live/h/mcp_spotify/mcp",
        tool_count: 5,
      });
    },
  });

  await client.deployMcp({
    sessionId: "session_123",
    name: "Spotify MCP",
    upstreamBaseUrl: "https://upstream.example.com",
    accessMode: "token",
    upstreamOAuthProvider: {
      provider: "spotify",
      authorizationEndpoint: "https://accounts.spotify.com/authorize",
      tokenEndpoint: "https://accounts.spotify.com/api/token",
      scopes: "user-read-playback-state",
      clientId: "client_abc",
      clientSecret: "secret_xyz",
    },
    endpoints: [{ method: "POST", path: "/tools/playback" }],
  });

  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.upstream_oauth_provider, {
    provider: "spotify",
    authorization_endpoint: "https://accounts.spotify.com/authorize",
    token_endpoint: "https://accounts.spotify.com/api/token",
    scopes: "user-read-playback-state",
    client_id: "client_abc",
    client_secret: "secret_xyz",
  });
  assert.equal(body.access_mode, "token");
});

test("startUpstreamOAuth uses owner control-plane route", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        authorization_url: "https://accounts.spotify.com/authorize?state=abc",
        state: "abc",
        expires_at: "2026-01-01T00:00:00+00:00",
        provider: "spotify",
        instructions: "Open the URL",
      });
    },
  });

  const result = await client.startUpstreamOAuth({ mcpId: "mcp_spotify" });
  assert.equal(calls[0].url, "https://api.preman.live/hosted-mcps/mcp_spotify/upstream-oauth/start");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(result.authorizationUrl, "https://accounts.spotify.com/authorize?state=abc");
});

test("startConsumerUpstreamOAuth uses consumer bearer against runtime route", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        authorization_url: "https://accounts.spotify.com/authorize?state=consumer",
        state: "consumer",
        expires_at: "2026-01-01T00:00:00+00:00",
        provider: "spotify",
        instructions: "Open the URL",
      });
    },
  });

  const result = await client.startConsumerUpstreamOAuth({
    mcpId: "mcp_spotify",
    consumerToken: "pm_hmcp_consumer_token_example",
  });

  assert.equal(calls[0].url, "https://api.preman.live/h/mcp_spotify/upstream-oauth/start");
  assert.equal(calls[0].init.headers.Authorization, "Bearer pm_hmcp_consumer_token_example");
  assert.equal(result.state, "consumer");
});

test("listEndpointHealth serializes filters and normalizes project endpoint aggregates", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(String(url)), init });
      return jsonResponse({
        project_id: "project_123",
        window: "24h",
        start: "2026-08-11T00:00:00Z",
        end: "2026-08-12T00:00:00Z",
        sort: "error_rate",
        endpoints: [{
          endpoint_key: "POST|api.example.com|/checkout",
          method: "POST",
          host: "api.example.com",
          path_template: "/checkout",
          runs: 12,
          failures: 2,
          error_rate: 0.1667,
          p50_ms: 110,
          p95_ms: 840,
          p99_ms: 1200,
          last_run_at: "2026-08-11T23:58:00Z",
        }],
        observations: {
          probes: [{
            method: "POST",
            path_template: "/checkout",
            last_ok: false,
            last_probe_at: "2026-08-11T23:59:00Z",
          }],
          logs: [{
            method: "POST",
            path_template: "/checkout",
            lines: 40,
            error_lines: 3,
            last_observed_at: "2026-08-11T23:59:30Z",
          }],
        },
      });
    },
  });

  const result = await client.listEndpointHealth({
    projectId: "project_123",
    window: "24h",
    statuses: ["failed", "error"],
    origin: "hosted",
    originLabel: "prod-runner",
    environmentId: "env_prod",
    minLatencyMs: 500,
    query: "checkout",
    sort: "error_rate",
    limit: 50,
  });

  assert.equal(calls[0].url.pathname, "/projects/project_123/api-runs/endpoints");
  assert.deepEqual(calls[0].url.searchParams.getAll("status"), ["failed", "error"]);
  assert.equal(calls[0].url.searchParams.get("origin_label"), "prod-runner");
  assert.equal(calls[0].url.searchParams.get("env_id"), "env_prod");
  assert.equal(calls[0].url.searchParams.get("min_latency_ms"), "500");
  assert.equal(calls[0].url.searchParams.get("q"), "checkout");
  assert.equal(calls[0].url.searchParams.get("sort"), "error_rate");
  assert.equal(calls[0].url.searchParams.get("limit"), "50");
  assert.equal(calls[0].init.method, "GET");
  assert.deepEqual(result.endpoints[0], {
    endpointKey: "POST|api.example.com|/checkout",
    method: "POST",
    host: "api.example.com",
    pathTemplate: "/checkout",
    runs: 12,
    failures: 2,
    errorRate: 0.1667,
    p50Ms: 110,
    p95Ms: 840,
    p99Ms: 1200,
    lastRunAt: "2026-08-11T23:58:00Z",
  });
  assert.equal(result.observations.probes[0].lastOk, false);
  assert.equal(result.observations.logs[0].errorLines, 3);
});

test("getEndpointHealthMetrics supports a custom range and normalizes the sparkline", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url) => {
      calls.push(new URL(String(url)));
      return jsonResponse({
        project_id: "project_123",
        window: "custom",
        start: "2026-08-10T00:00:00.000Z",
        end: "2026-08-12T00:00:00.000Z",
        bucket_seconds: 3600,
        total: 20,
        failed: 2,
        errored: 1,
        error_rate: 0.15,
        pass_rate: 0.85,
        p50_ms: 100,
        p95_ms: 900,
        p99_ms: 1500,
        avg_ms: 180,
        max_ms: 2000,
        last_run_at: "2026-08-11T23:00:00Z",
        sparkline: [{
          ts: "2026-08-11T23:00:00Z",
          runs: 4,
          failures: 1,
          p50_ms: 120,
          p95_ms: 950,
        }],
      });
    },
  });

  const result = await client.getEndpointHealthMetrics({
    projectId: "project_123",
    start: new Date("2026-08-10T00:00:00Z"),
    end: new Date("2026-08-12T00:00:00Z"),
    endpointKey: "POST|api.example.com|/checkout",
  });

  assert.equal(calls[0].pathname, "/projects/project_123/api-runs/metrics");
  assert.equal(calls[0].searchParams.get("start"), "2026-08-10T00:00:00.000Z");
  assert.equal(calls[0].searchParams.get("end"), "2026-08-12T00:00:00.000Z");
  assert.equal(calls[0].searchParams.get("endpoint_key"), "POST|api.example.com|/checkout");
  assert.equal(result.passRate, 0.85);
  assert.equal(result.averageMs, 180);
  assert.deepEqual(result.sparkline[0], {
    timestamp: "2026-08-11T23:00:00Z",
    runs: 4,
    failures: 1,
    p50Ms: 120,
    p95Ms: 950,
  });
});

test("getEndpointDependencies returns directed evidence-backed edges", async () => {
  const calls = [];
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(String(url)), init });
      return jsonResponse({
        project_id: "project_123",
        direction: "source_depends_on_target",
        edges: [{
          id: "dep_1",
          source: { id: "checkout", name: "Checkout", method: "POST", host: "api.example.com", path_template: "/checkout" },
          target: { id: "session", name: "Session", method: "POST", host: "api.example.com", path_template: "/sessions" },
          edge_type: "depends_on",
          confidence: 1,
          evidence: { source: "collection", collection_name: "Purchase" },
        }],
        sources: { endpoint_edges: 0, collection_declarations: 1 },
      });
    },
  });

  const result = await client.getEndpointDependencies({ projectId: "project_123" });

  assert.equal(calls[0].url.pathname, "/projects/project_123/endpoint-dependencies");
  assert.equal(calls[0].init.method, "GET");
  assert.deepEqual(result.edges[0], {
    id: "dep_1",
    source: { id: "checkout", name: "Checkout", method: "POST", host: "api.example.com", pathTemplate: "/checkout" },
    target: { id: "session", name: "Session", method: "POST", host: "api.example.com", pathTemplate: "/sessions" },
    edgeType: "depends_on",
    confidence: 1,
    evidence: { source: "collection", collection_name: "Purchase" },
  });
  assert.equal(result.sources.collectionDeclarations, 1);
});

test("endpoint health custom ranges require both bounds", async () => {
  const client = new PremanClient({
    apiKey: "pm_live_12345678901234567890123456789012",
    fetchImpl: async () => jsonResponse({}),
  });

  await assert.rejects(
    client.getEndpointHealthMetrics({
      projectId: "project_123",
      start: "2026-08-10T00:00:00Z",
    }),
    (error) => error instanceof PremanConfigError && /start and end/.test(error.message),
  );
});
