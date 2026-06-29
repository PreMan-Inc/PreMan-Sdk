import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_UPSTREAM_HOSTING_GUIDE,
  PREMAN_UPSTREAM_HOSTING_FEATURE_ID,
  UPSTREAM_MODE_PREMAN,
  buildUpstreamDeployBody,
  defaultPremanCapabilities,
  normalizePremanCapabilities,
  resolveUpstreamDeployPlan,
  supportsPremanUpstreamHosting,
  validateUpstreamDeployRequest,
} from "../dist/upstream-hosting.js";
import { PremanConfigError } from "../dist/index.js";

test("default capabilities only expose external upstream mode", () => {
  const caps = defaultPremanCapabilities();
  assert.equal(caps.upstreamHosting.featureId, PREMAN_UPSTREAM_HOSTING_FEATURE_ID);
  assert.equal(supportsPremanUpstreamHosting(caps), false);
  assert.deepEqual(caps.upstreamHosting.modes, ["external"]);
});

test("normalizePremanCapabilities reads preman upstream hosting support", () => {
  const caps = normalizePremanCapabilities({
    version: "2026-06-27",
    upstream_hosting: {
      supported: true,
      modes: ["external", "preman"],
      default_mode: "preman",
      supports_dockerfile_build: true,
      supports_image_deploy: true,
    },
  });
  assert.equal(supportsPremanUpstreamHosting(caps), true);
  assert.equal(caps.upstreamHosting.defaultMode, "preman");
});

test("buildUpstreamDeployBody sends preman mode payload", () => {
  const body = buildUpstreamDeployBody({
    name: "Spotify MCP",
    upstreamMode: "preman",
    upstreamBuild: { dockerfile: "Dockerfile", port: 8000, healthPath: "/health" },
    endpoints: [{ method: "POST", path: "/tools/playback" }],
  });
  assert.equal(body.upstream_mode, "preman");
  assert.deepEqual(body.upstream_build, {
    dockerfile: "Dockerfile",
    port: 8000,
    health_path: "/health",
  });
  assert.equal(body.upstream_base_url, undefined);
});

test("validateUpstreamDeployRequest requires external upstream URL", () => {
  assert.throws(
    () => validateUpstreamDeployRequest({ name: "x", endpoints: [{}] }),
    (error) => error instanceof PremanConfigError,
  );
});

test("resolveUpstreamDeployPlan prefers preman when supported", () => {
  const plan = resolveUpstreamDeployPlan({
    preferPremanHosting: true,
    upstreamBuild: { dockerfile: "Dockerfile" },
    capabilities: normalizePremanCapabilities({
      upstream_hosting: { supported: true, modes: ["external", "preman"] },
    }),
  });
  assert.equal(plan.upstreamMode, UPSTREAM_MODE_PREMAN);
  assert.match(plan.guidance, /getUpstreamHostingStatus/i);
});

test("agent guide is exported for SDK discovery", () => {
  assert.match(AGENT_UPSTREAM_HOSTING_GUIDE, /getCapabilities\(\)/);
  assert.match(AGENT_UPSTREAM_HOSTING_GUIDE, /upstreamMode/);
});
