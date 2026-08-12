import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  evaluateStateAssertions,
  runHttpAssertionCheck,
  runStateAssertionConfig,
} from "../dist/assertions.js";
import * as main from "../dist/index.js";

function response(body, init = {}) {
  return new Response(body, init);
}

function delayedJsonResponse(value, delayMs) {
  const encoder = new TextEncoder();
  return response(new ReadableStream({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(encoder.encode(JSON.stringify(value)));
        controller.close();
      }, delayMs);
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("JSON Pointer selection handles root, nesting, arrays, escaping, missing, and invalid syntax", () => {
  const value = {
    plain: "root",
    nested: { list: [{ ok: true }] },
    "a/b": { "tilde~key": 42 },
  };
  const results = evaluateStateAssertions({ found: true, value }, [
    { op: "equals", expected: value },
    { op: "equals", pointer: "/nested/list/0/ok", expected: true },
    { op: "equals", pointer: "/a~1b/tilde~0key", expected: 42 },
    { op: "exists", pointer: "/nested/list/1" },
    { op: "exists", pointer: "nested/list" },
    { op: "exists", pointer: "/nested/~2bad" },
  ]);

  assert.deepEqual(results.results.map((item) => item.verdict), [
    "passed",
    "passed",
    "passed",
    "failed",
    "error",
    "error",
  ]);
  assert.equal(results.results[3].code, "path_missing");
  assert.equal(results.results[4].code, "invalid_pointer");
  assert.equal(results.results[5].code, "invalid_pointer");
});

test("exists and not_exists use structural presence instead of truthiness", () => {
  const observation = {
    found: true,
    value: { absentParent: {}, values: [null, false, 0, "", {}, []] },
  };
  const results = evaluateStateAssertions(observation, [
    { op: "exists", pointer: "/values/0" },
    { op: "exists", pointer: "/values/1" },
    { op: "exists", pointer: "/values/2" },
    { op: "exists", pointer: "/values/3" },
    { op: "exists", pointer: "/values/4" },
    { op: "exists", pointer: "/values/5" },
    { op: "not_exists", pointer: "/absentParent/missing" },
    { op: "not_exists", pointer: "/values/0" },
  ]);

  assert.deepEqual(results.results.map((item) => item.verdict), [
    "passed",
    "passed",
    "passed",
    "passed",
    "passed",
    "passed",
    "passed",
    "failed",
  ]);
  assert.equal(results.verdict, "failed");
  assert.equal(results.results[7].code, "unexpected_presence");
  assert.equal(results.results[7].actual, null);
});

test("equals is deep, strict, order-insensitive for object keys, and order-sensitive for arrays", () => {
  const results = evaluateStateAssertions({
    found: true,
    value: {
      object: { a: 1, b: { c: true } },
      array: [1, 2],
      number: 82,
    },
  }, [
    { op: "equals", pointer: "/object", expected: { b: { c: true }, a: 1 } },
    { op: "equals", pointer: "/array", expected: [1, 2] },
    { op: "equals", pointer: "/array", expected: [2, 1] },
    { op: "equals", pointer: "/number", expected: "82" },
  ]);

  assert.deepEqual(results.results.map((item) => item.verdict), ["passed", "passed", "failed", "failed"]);
  assert.equal(results.results[2].code, "not_equal");
  assert.equal(results.results[3].code, "not_equal");
});

test("contains supports strings and arrays only", () => {
  const results = evaluateStateAssertions({
    found: true,
    value: {
      message: "refund issued for order 1049",
      records: [{ id: "refund_1", amount: 82 }, "done"],
      object: { id: "refund_1" },
    },
  }, [
    { op: "contains", pointer: "/message", expected: "issued" },
    { op: "contains", pointer: "/message", expected: "voided" },
    { op: "contains", pointer: "/records", expected: { amount: 82, id: "refund_1" } },
    { op: "contains", pointer: "/records", expected: "missing" },
    { op: "contains", pointer: "/object", expected: { id: "refund_1" } },
  ]);

  assert.deepEqual(results.results.map((item) => item.verdict), [
    "passed",
    "failed",
    "passed",
    "failed",
    "error",
  ]);
  assert.equal(results.results[4].code, "unsupported_target");
});

test("no_duplicate treats the selected target as an already-filtered result collection", () => {
  const results = evaluateStateAssertions({
    found: true,
    value: { empty: [], one: [{ id: 1 }], two: [{ id: 1 }, { id: 1 }], wrong: { id: 1 } },
  }, [
    { op: "no_duplicate", pointer: "/empty" },
    { op: "no_duplicate", pointer: "/one" },
    { op: "no_duplicate", pointer: "/two" },
    { op: "no_duplicate", pointer: "/wrong" },
  ]);

  assert.deepEqual(results.results.map((item) => item.verdict), ["passed", "passed", "failed", "error"]);
  assert.equal(results.results[2].code, "duplicate_records");
  assert.deepEqual(results.results[2].actual, { count: 2 });
  assert.equal(results.results[3].code, "unsupported_target");
});

test("latency_threshold is source-agnostic and missing latency is an evaluation error", () => {
  assert.deepEqual(evaluateStateAssertions({ found: true, value: {}, latencyMs: 25 }, [
    { op: "latency_threshold", maxMs: 25 },
    { op: "latency_threshold", maxMs: 20 },
  ]).results.map((item) => item.verdict), ["passed", "failed"]);

  const missing = evaluateStateAssertions({ found: true, value: {} }, [
    { op: "latency_threshold", maxMs: 20 },
  ]);
  assert.equal(missing.verdict, "error");
  assert.equal(missing.results[0].code, "missing_latency");
});

test("404 is a probe error by default and business-level absence only when configured", async () => {
  const unconfigured = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/refunds/unknown" },
    assertions: [{ op: "not_exists" }],
  }, {
    fetchImpl: async () => response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(unconfigured.verdict, "error");
  assert.equal(unconfigured.error?.code, "probe_http_error");
  assert.equal(unconfigured.assertions.length, 0);

  const configuredNotExists = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/refunds/unknown", notFoundStatuses: [404] },
    assertions: [{ op: "not_exists" }],
  }, {
    fetchImpl: async () => response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(configuredNotExists.verdict, "passed");
  assert.equal(configuredNotExists.probe.status, 404);
  assert.equal(configuredNotExists.assertions[0].verdict, "passed");

  const configuredExists = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/refunds/unknown", notFoundStatuses: [404] },
    assertions: [{ op: "exists" }],
  }, {
    fetchImpl: async () => response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(configuredExists.verdict, "failed");
  assert.equal(configuredExists.assertions[0].verdict, "failed");
  assert.deepEqual(configuredExists.assertions[0].expected, { present: true });
  assert.deepEqual(configuredExists.assertions[0].actual, { present: false });
  assert.equal(configuredExists.assertions[0].probeEndpoint, "https://api.example.com/refunds/unknown");

  const forbidden = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/refunds" },
    assertions: [{ op: "not_exists" }],
  }, {
    fetchImpl: async () => response("forbidden", { status: 403 }),
  });
  assert.equal(forbidden.verdict, "error");
  assert.equal(forbidden.error?.code, "probe_http_error");
  assert.equal(forbidden.assertions.length, 0);

  const badJson = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/refunds" },
    assertions: [{ op: "exists" }],
  }, {
    fetchImpl: async () => response("{", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(badJson.verdict, "error");
  assert.equal(badJson.error?.code, "probe_invalid_json");
});

test("HTTP error statuses are verifier errors, not assertion mismatches", async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const result = await runHttpAssertionCheck({
      probe: { url: `https://api.example.com/status/${status}` },
      assertions: [{ op: "not_exists" }],
    }, {
      fetchImpl: async () => response(JSON.stringify({ status }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    });

    assert.equal(result.verdict, "error");
    assert.equal(result.error?.code, "probe_http_error");
    assert.equal(result.assertions.length, 0);
  }
});

test("HTTP probes support HEAD, empty success bodies, text bodies, timeouts, and fetch failures", async () => {
  const head = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/health", method: "HEAD" },
    assertions: [{ op: "exists" }, { op: "latency_threshold", maxMs: 1000 }],
  }, {
    fetchImpl: async () => response(null, { status: 200 }),
  });
  assert.equal(head.verdict, "passed");
  assert.equal(head.probe.method, "HEAD");

  const empty = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/refunds" },
    assertions: [{ op: "equals", expected: null }],
  }, {
    fetchImpl: async () => response(null, { status: 204 }),
  });
  assert.equal(empty.verdict, "passed");

  const text = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/status" },
    assertions: [{ op: "contains", expected: "ready" }],
  }, {
    fetchImpl: async () => response("system ready", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
  });
  assert.equal(text.verdict, "passed");

  const unsupported = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/blob" },
    assertions: [{ op: "exists" }],
  }, {
    fetchImpl: async () => response("abc", {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }),
  });
  assert.equal(unsupported.verdict, "error");
  assert.equal(unsupported.error?.code, "probe_unsupported_content_type");

  const timeout = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/slow", timeoutMs: 1 },
    assertions: [{ op: "exists" }],
  }, {
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  });
  assert.equal(timeout.verdict, "error");
  assert.equal(timeout.error?.code, "probe_timeout");

  const rejected = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/down" },
    assertions: [{ op: "exists" }],
  }, {
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(rejected.verdict, "error");
  assert.equal(rejected.error?.code, "probe_network_error");
});

test("HTTP probe timeout covers stalled response bodies", async () => {
  const result = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/slow-body", timeoutMs: 10 },
    assertions: [{ op: "exists" }],
  }, {
    fetchImpl: async () => delayedJsonResponse({ ok: true }, 100),
  });

  assert.equal(result.verdict, "error");
  assert.equal(result.error?.code, "probe_timeout");
});

test("HTTP probe latency measures usable observation latency through body parsing", async () => {
  const result = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/slow-body", timeoutMs: 1000 },
    assertions: [{ op: "latency_threshold", maxMs: 10 }],
  }, {
    fetchImpl: async () => delayedJsonResponse({ ok: true }, 80),
  });

  assert.equal(result.verdict, "failed");
  assert.equal(result.assertions[0].code, "latency_exceeded");
  assert.equal(typeof result.assertions[0].actual, "number");
  assert.ok(result.assertions[0].actual >= 10);
});

test("HTTP probes are read-only, reject unsafe URLs and redirects, and do not serialize secrets", async () => {
  const unsafe = await runHttpAssertionCheck({
    probe: { url: "https://user:pass@api.example.com/refunds" },
    assertions: [{ op: "exists" }],
  });
  assert.equal(unsafe.verdict, "error");
  assert.equal(unsafe.error?.code, "invalid_probe_url");

  const method = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/refunds", method: "POST" },
    assertions: [{ op: "exists" }],
  });
  assert.equal(method.verdict, "error");
  assert.equal(method.error?.code, "invalid_probe_method");

  const missingSecret = await runHttpAssertionCheck({
    probe: {
      url: "https://api.example.com/refunds?token=secret-value&order_id=1049",
      headersFromEnv: { Authorization: "MISSING_ASSERT_SECRET" },
    },
    assertions: [{ op: "exists" }],
  });
  assert.equal(missingSecret.verdict, "error");
  assert.equal(missingSecret.error?.code, "probe_missing_secret");
  assert.equal(missingSecret.probe.endpoint, "https://api.example.com/refunds?token=REDACTED&order_id=REDACTED");

  const redirect = await runHttpAssertionCheck({
    probe: {
      url: "https://api.example.com/refunds?token=secret-value",
      headersFromEnv: { Authorization: "ASSERT_AUTH_TOKEN" },
    },
    assertions: [{ op: "exists" }],
  }, {
    env: { ASSERT_AUTH_TOKEN: "Bearer top-secret" },
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Authorization, "Bearer top-secret");
      return response("", {
        status: 302,
        headers: { location: "https://evil.example.com" },
      });
    },
  });
  assert.equal(redirect.verdict, "error");
  assert.equal(redirect.error?.code, "probe_redirect_rejected");
  assert.equal(JSON.stringify(redirect).includes("top-secret"), false);
  assert.equal(JSON.stringify(redirect).includes("secret-value"), false);
});

test("HTTP probe endpoint evidence redacts query values, strips fragments, and hides malformed URLs", async () => {
  const query = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/refunds?token=secret&order_id=123" },
    assertions: [{ op: "exists" }],
  }, {
    fetchImpl: async () => response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(query.probe.endpoint, "https://api.example.com/refunds?token=REDACTED&order_id=REDACTED");

  const fragment = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/refunds#access_token=secret" },
    assertions: [{ op: "exists" }],
  }, {
    fetchImpl: async () => response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(fragment.probe.endpoint, "https://api.example.com/refunds");
  assert.equal(JSON.stringify(fragment).includes("access_token"), false);

  const malformed = await runHttpAssertionCheck({
    probe: { url: "not-a-valid-url?token=secret" },
    assertions: [{ op: "exists" }],
  });
  assert.equal(malformed.verdict, "error");
  assert.equal(malformed.probe.endpoint, "<invalid-url>");
  assert.equal(JSON.stringify(malformed).includes("secret"), false);

  const unsafeScheme = await runHttpAssertionCheck({
    probe: { url: "data:text/plain,super-secret-value" },
    assertions: [{ op: "exists" }],
  });
  assert.equal(unsafeScheme.verdict, "error");
  assert.equal(unsafeScheme.error?.code, "invalid_probe_url");
  assert.equal(unsafeScheme.probe.endpoint, "<invalid-url>");
  assert.equal(JSON.stringify(unsafeScheme).includes("super-secret-value"), false);
});

test("HTTP assertion failures include expected, actual, and sanitized probe endpoint evidence", async () => {
  const result = await runHttpAssertionCheck({
    probe: { url: "https://api.example.com/refunds?token=secret&order_id=1049" },
    assertions: [{ op: "equals", pointer: "/refunds/0/amount", expected: 82 }],
  }, {
    fetchImpl: async () => response(JSON.stringify({ refunds: [{ amount: 80 }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  assert.equal(result.verdict, "failed");
  assert.equal(result.assertions[0].expected, 82);
  assert.equal(result.assertions[0].actual, 80);
  assert.equal(result.assertions[0].probeEndpoint, "https://api.example.com/refunds?token=REDACTED&order_id=REDACTED");
});

test("file-based assertion config rejects literal headers but accepts headersFromEnv", async () => {
  const rejected = await runStateAssertionConfig({
    probe: {
      url: "https://api.example.com/refunds",
      headers: { Authorization: "Bearer secret" },
    },
    assertions: [{ op: "exists" }],
  });
  assert.equal(rejected.verdict, "error");
  assert.equal(rejected.error?.code, "literal_probe_headers_disallowed");
  assert.equal(JSON.stringify(rejected).includes("Bearer secret"), false);

  let authorization;
  const accepted = await runStateAssertionConfig({
    probe: {
      url: "https://api.example.com/refunds",
      headersFromEnv: { Authorization: "ASSERT_AUTH_TOKEN" },
    },
    assertions: [{ op: "exists" }],
  }, {
    env: { ASSERT_AUTH_TOKEN: "Bearer top-secret" },
    fetchImpl: async (_url, init) => {
      authorization = init.headers.Authorization;
      return response(JSON.stringify({ refunds: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(accepted.verdict, "passed");
  assert.equal(authorization, "Bearer top-secret");
  assert.equal(JSON.stringify(accepted).includes("top-secret"), false);
});

test("main package re-exports assertion helpers", () => {
  assert.equal(typeof main.evaluateStateAssertions, "function");
  assert.equal(typeof main.runHttpAssertionCheck, "function");
  assert.equal("resolveJsonPointer" in main, false);
});

test("preman assert CLI prints consistent JSON, does not require PREMAN_API_KEY, and exits by verdict", () => {
  const dir = mkdtempSync(join(tmpdir(), "preman-assert-"));
  const passFile = join(dir, "pass.json");
  const failFile = join(dir, "fail.json");
  const literalHeaderFile = join(dir, "literal-header.json");
  const malformedFile = join(dir, "malformed.json");
  writeFileSync(passFile, `${JSON.stringify({
    observation: { found: true, value: { refunds: [{ amount: 82 }] }, latencyMs: 4 },
    assertions: [
      { op: "exists", pointer: "/refunds/0" },
      { op: "equals", pointer: "/refunds/0/amount", expected: 82 },
      { op: "latency_threshold", maxMs: 10 },
    ],
  })}\n`);
  writeFileSync(failFile, `${JSON.stringify({
    observation: { found: true, value: { refunds: [{ amount: 80 }] } },
    assertions: [{ op: "equals", pointer: "/refunds/0/amount", expected: 82 }],
  })}\n`);
  writeFileSync(literalHeaderFile, `${JSON.stringify({
    probe: {
      url: "https://api.example.com/refunds",
      headers: { Authorization: "Bearer secret" },
    },
    assertions: [{ op: "exists" }],
  })}\n`);
  writeFileSync(malformedFile, `{
  "probe": {
    "url": "https://api.example.com/refunds",
    "headers": { "Authorization": Bearer super-secret-value }
  },
  "assertions": [{ "op": "exists" }]
}\n`);

  const pass = spawnSync(process.execPath, ["dist/cli.js", "assert", "--file", passFile], {
    cwd: process.cwd(),
    env: {},
    encoding: "utf8",
  });
  assert.equal(pass.status, 0, pass.stderr);
  const parsedPass = JSON.parse(pass.stdout);
  assert.equal(parsedPass.verdict, "passed");
  assert.equal(Array.isArray(parsedPass.assertions), true);
  assert.equal("results" in parsedPass, false);

  const fail = spawnSync(process.execPath, ["dist/cli.js", "assert", "--file", failFile], {
    cwd: process.cwd(),
    env: {},
    encoding: "utf8",
  });
  assert.equal(fail.status, 1);
  const parsed = JSON.parse(fail.stdout);
  assert.equal(parsed.verdict, "failed");
  assert.equal(Array.isArray(parsed.assertions), true);
  assert.equal("results" in parsed, false);
  assert.equal(parsed.assertions[0].expected, 82);
  assert.equal(parsed.assertions[0].actual, 80);

  const literalHeader = spawnSync(process.execPath, ["dist/cli.js", "assert", "--file", literalHeaderFile], {
    cwd: process.cwd(),
    env: {},
    encoding: "utf8",
  });
  assert.equal(literalHeader.status, 1);
  const parsedLiteralHeader = JSON.parse(literalHeader.stdout);
  assert.equal(parsedLiteralHeader.verdict, "error");
  assert.equal(parsedLiteralHeader.error.code, "literal_probe_headers_disallowed");
  assert.equal(`${literalHeader.stdout}${literalHeader.stderr}`.includes("Bearer secret"), false);

  const malformed = spawnSync(process.execPath, ["dist/cli.js", "assert", "--file", malformedFile], {
    cwd: process.cwd(),
    env: {},
    encoding: "utf8",
  });
  assert.equal(malformed.status, 1);
  const parsedMalformed = JSON.parse(malformed.stdout);
  assert.equal(parsedMalformed.verdict, "error");
  assert.deepEqual(parsedMalformed.assertions, []);
  assert.equal(parsedMalformed.error.code, "invalid_config");
  assert.equal(parsedMalformed.error.message, "Assertion config file is not valid JSON.");
  const malformedOutput = `${malformed.stdout}${malformed.stderr}`;
  assert.equal(malformedOutput.includes("super-secret-value"), false);
  assert.equal(malformedOutput.includes("super-secret"), false);
  assert.equal(malformedOutput.includes("Bearer"), false);
});
