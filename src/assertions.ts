export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type StateAssertion =
  | { op: "exists"; pointer?: string; label?: string }
  | { op: "not_exists"; pointer?: string; label?: string }
  | { op: "equals"; pointer?: string; expected: JsonValue; label?: string }
  | { op: "contains"; pointer?: string; expected: JsonValue; label?: string }
  | { op: "no_duplicate"; pointer?: string; label?: string }
  | { op: "latency_threshold"; maxMs: number; label?: string };

export type StateObservation = {
  found: boolean;
  value?: JsonValue;
  latencyMs?: number;
};

export type AssertionVerdict = "passed" | "failed" | "error";

export type AssertionResult = {
  op: StateAssertion["op"];
  verdict: AssertionVerdict;
  code: string;
  message: string;
  label?: string;
  pointer?: string;
  expected?: unknown;
  actual?: unknown;
  probeEndpoint?: string;
};

export type AssertionBatchResult = {
  verdict: AssertionVerdict;
  results: AssertionResult[];
};

type JsonPointerResolution = {
  found: boolean;
  value?: unknown;
  error?: {
    code: "invalid_pointer";
    message: string;
  };
};

export type HttpProbeSpec = {
  url: string;
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  headersFromEnv?: Record<string, string>;
  notFoundStatuses?: number[];
  timeoutMs?: number;
};

export type HttpProbeEvidence = {
  endpoint: string;
  method: "GET" | "HEAD";
  durationMs: number;
  status?: number;
  contentType?: string;
};

export type HttpAssertionCheckConfig = {
  id?: string;
  probe: HttpProbeSpec;
  assertions: StateAssertion[];
};

export type AssertionConfig = {
  id?: string;
  observation?: StateObservation;
  probe?: HttpProbeSpec;
  assertions: StateAssertion[];
};

export type ProbeError = {
  code: string;
  message: string;
};

export type HttpAssertionCheckResult = {
  verdict: AssertionVerdict;
  assertions: AssertionResult[];
  probe: HttpProbeEvidence;
  id?: string;
  error?: ProbeError;
};

export type AssertionConfigResult = {
  verdict: AssertionVerdict;
  assertions: AssertionResult[];
  id?: string;
  probe?: HttpProbeEvidence;
  error?: ProbeError;
};

export type HttpAssertionCheckOptions = {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
};

type AssertionContext = {
  probeEndpoint?: string;
};

type NormalizedProbe = {
  url: URL;
  method: "GET" | "HEAD";
  timeoutMs: number;
  headers: Record<string, string>;
  notFoundStatuses: number[];
  evidence: HttpProbeEvidence;
};

const DEFAULT_TIMEOUT_MS = 5_000;

function resolveJsonPointer(value: unknown, pointer = ""): JsonPointerResolution {
  if (pointer === "") {
    return { found: true, value };
  }
  if (!pointer.startsWith("/")) {
    return {
      found: false,
      error: { code: "invalid_pointer", message: "JSON Pointer must be empty or start with /." },
    };
  }

  const parts = pointer.slice(1).split("/");
  let current = value;
  for (const rawPart of parts) {
    const part = decodePointerSegment(rawPart);
    if (part === undefined) {
      return {
        found: false,
        error: { code: "invalid_pointer", message: "JSON Pointer contains an invalid escape sequence." },
      };
    }

    if (Array.isArray(current)) {
      if (!isArrayIndex(part)) return { found: false };
      const index = Number(part);
      if (index >= current.length) return { found: false };
      current = current[index];
      continue;
    }

    if (isRecord(current)) {
      if (!Object.prototype.hasOwnProperty.call(current, part)) return { found: false };
      current = current[part];
      continue;
    }

    return { found: false };
  }

  return { found: true, value: current };
}

export function evaluateStateAssertion(
  observation: StateObservation,
  assertion: StateAssertion,
  context: AssertionContext = {},
): AssertionResult {
  if (assertion.op === "latency_threshold") {
    if (!Number.isFinite(assertion.maxMs) || assertion.maxMs < 0) {
      return result(assertion, "error", "invalid_assertion", "latency_threshold requires a non-negative maxMs.", context);
    }
    if (typeof observation.latencyMs !== "number" || !Number.isFinite(observation.latencyMs)) {
      return result(assertion, "error", "missing_latency", "Observation does not include latencyMs.", context, {
        expected: { maxMs: assertion.maxMs },
        actual: undefined,
      });
    }
    if (observation.latencyMs <= assertion.maxMs) {
      return result(assertion, "passed", "assertion_passed", "Observed latency is within threshold.", context);
    }
    return result(assertion, "failed", "latency_exceeded", "Observed latency exceeds threshold.", context, {
      expected: { maxMs: assertion.maxMs },
      actual: observation.latencyMs,
    });
  }

  const selected = selectObservationValue(observation, assertion.pointer);
  if (selected.error) {
    return result(assertion, "error", selected.error.code, selected.error.message, context);
  }

  switch (assertion.op) {
    case "exists":
      if (selected.found) {
        return result(assertion, "passed", "assertion_passed", "Selected value exists.", context);
      }
      return result(assertion, "failed", "path_missing", "Selected value is missing.", context, {
        expected: { present: true },
        actual: { present: false },
      });

    case "not_exists":
      if (!selected.found) {
        return result(assertion, "passed", "assertion_passed", "Selected value is absent.", context);
      }
      return result(assertion, "failed", "unexpected_presence", "Selected value exists.", context, {
        expected: { present: false },
        actual: selected.value,
      });

    case "equals":
      if (!selected.found) {
        return result(assertion, "failed", "path_missing", "Selected value is missing.", context, {
          expected: assertion.expected,
          actual: { present: false },
        });
      }
      if (deepEqual(selected.value, assertion.expected)) {
        return result(assertion, "passed", "assertion_passed", "Selected value equals expected value.", context);
      }
      return result(assertion, "failed", "not_equal", "Selected value does not equal expected value.", context, {
        expected: assertion.expected,
        actual: selected.value,
      });

    case "contains":
      if (!selected.found) {
        return result(assertion, "failed", "path_missing", "Selected value is missing.", context, {
          expected: assertion.expected,
          actual: { present: false },
        });
      }
      if (typeof selected.value === "string") {
        if (typeof assertion.expected !== "string") {
          return result(assertion, "error", "unsupported_expected", "String containment requires a string expected value.", context, {
            expected: assertion.expected,
            actual: typeName(selected.value),
          });
        }
        if (selected.value.includes(assertion.expected)) {
          return result(assertion, "passed", "assertion_passed", "Selected string contains expected substring.", context);
        }
        return result(assertion, "failed", "not_contained", "Selected string does not contain expected substring.", context, {
          expected: assertion.expected,
          actual: selected.value,
        });
      }
      if (Array.isArray(selected.value)) {
        if (selected.value.some((item) => deepEqual(item, assertion.expected))) {
          return result(assertion, "passed", "assertion_passed", "Selected array contains expected member.", context);
        }
        return result(assertion, "failed", "not_contained", "Selected array does not contain expected member.", context, {
          expected: assertion.expected,
          actual: selected.value,
        });
      }
      return result(assertion, "error", "unsupported_target", "contains supports only string and array targets.", context, {
        expected: assertion.expected,
        actual: typeName(selected.value),
      });

    case "no_duplicate":
      if (!selected.found) {
        return result(assertion, "failed", "path_missing", "Selected value is missing.", context, {
          expected: { maxCount: 1 },
          actual: { present: false },
        });
      }
      if (!Array.isArray(selected.value)) {
        return result(assertion, "error", "unsupported_target", "no_duplicate requires an array target.", context, {
          expected: "array",
          actual: typeName(selected.value),
        });
      }
      if (selected.value.length <= 1) {
        return result(assertion, "passed", "assertion_passed", "Selected collection has no duplicates.", context);
      }
      return result(assertion, "failed", "duplicate_records", "Selected collection contains multiple records.", context, {
        expected: { maxCount: 1 },
        actual: { count: selected.value.length },
      });

  }
}

export function evaluateStateAssertions(
  observation: StateObservation,
  assertions: StateAssertion[],
  context: AssertionContext = {},
): AssertionBatchResult {
  const results = assertions.map((assertion) => evaluateStateAssertion(observation, assertion, context));
  return {
    verdict: aggregateVerdict(results.map((item) => item.verdict)),
    results,
  };
}

export async function runStateAssertionConfig(
  config: unknown,
  options: HttpAssertionCheckOptions = {},
): Promise<AssertionConfigResult> {
  const parsed = parseAssertionConfig(config);
  if (parsed.error) {
    return {
      id: parsed.id,
      verdict: "error",
      assertions: [],
      error: parsed.error,
    };
  }

  if (parsed.config.probe) {
    return runHttpAssertionCheck({
      id: parsed.config.id,
      probe: parsed.config.probe,
      assertions: parsed.config.assertions,
    }, options);
  }

  const evaluated = evaluateStateAssertions(parsed.config.observation, parsed.config.assertions);
  return {
    id: parsed.config.id,
    verdict: evaluated.verdict,
    assertions: evaluated.results,
  };
}

export async function runHttpAssertionCheck(
  config: HttpAssertionCheckConfig,
  options: HttpAssertionCheckOptions = {},
): Promise<HttpAssertionCheckResult> {
  const assertions = parseAssertions(config.assertions);
  const normalized = normalizeProbe(config.probe, options.env ?? process.env);
  if (assertions.error) {
    return {
      id: config.id,
      verdict: "error",
      assertions: [],
      probe: normalized.probe.evidence,
      error: assertions.error,
    };
  }
  if (normalized.error) {
    return {
      id: config.id,
      verdict: "error",
      assertions: [],
      probe: normalized.probe.evidence,
      error: normalized.error,
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return probeError(config.id, normalized.probe.evidence, "probe_fetch_unavailable", "No fetch implementation available.");
  }

  const controller = new AbortController();
  const started = Date.now();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, normalized.probe.timeoutMs);

  try {
    const response = await fetchImpl(normalized.probe.url, {
      method: normalized.probe.method,
      headers: normalized.probe.headers,
      redirect: "manual",
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      const evidence = withProbeTiming(normalized.probe.evidence, started, response);
      return probeError(config.id, evidence, "probe_redirect_rejected", "HTTP probe rejected a redirect response.");
    }
    if (normalized.probe.notFoundStatuses.includes(response.status)) {
      const evidence = withProbeTiming(normalized.probe.evidence, started, response);
      return checkObservation(config.id, evidence, { found: false, latencyMs: evidence.durationMs }, assertions.assertions);
    }
    if (!response.ok) {
      const evidence = withProbeTiming(normalized.probe.evidence, started, response);
      return probeError(config.id, evidence, "probe_http_error", `HTTP probe returned status ${response.status}.`);
    }

    const parsed = await parseProbeBody(response, normalized.probe.method, controller.signal);
    const evidence = withProbeTiming(normalized.probe.evidence, started, response);
    if (parsed.error) {
      return probeError(config.id, evidence, parsed.error.code, parsed.error.message);
    }
    return checkObservation(config.id, evidence, {
      found: true,
      value: parsed.value,
      latencyMs: evidence.durationMs,
    }, assertions.assertions);
  } catch (error) {
    const evidence = {
      ...normalized.probe.evidence,
      durationMs: Math.max(0, Date.now() - started),
    };
    if (timedOut || isAbortError(error)) {
      return probeError(config.id, evidence, "probe_timeout", "HTTP probe timed out.");
    }
    return probeError(config.id, evidence, "probe_network_error", "HTTP probe failed before a trustworthy response was observed.");
  } finally {
    clearTimeout(timeout);
  }
}

function checkObservation(
  id: string | undefined,
  probe: HttpProbeEvidence,
  observation: StateObservation,
  assertions: StateAssertion[],
): HttpAssertionCheckResult {
  const evaluated = evaluateStateAssertions(observation, assertions, { probeEndpoint: probe.endpoint });
  return {
    id,
    verdict: evaluated.verdict,
    probe,
    assertions: evaluated.results,
  };
}

function selectObservationValue(observation: StateObservation, pointer: string | undefined): JsonPointerResolution {
  if (!observation.found) {
    return { found: false };
  }
  return resolveJsonPointer(observation.value ?? null, pointer ?? "");
}

function result(
  assertion: StateAssertion,
  verdict: AssertionVerdict,
  code: string,
  message: string,
  context: AssertionContext,
  evidence: { expected?: unknown; actual?: unknown } = {},
): AssertionResult {
  return omitUndefined({
    op: assertion.op,
    label: assertion.label,
    pointer: "pointer" in assertion ? assertion.pointer : undefined,
    verdict,
    code,
    expected: evidence.expected,
    actual: evidence.actual,
    probeEndpoint: context.probeEndpoint,
    message,
  });
}

function aggregateVerdict(verdicts: AssertionVerdict[]): AssertionVerdict {
  if (verdicts.includes("error")) return "error";
  if (verdicts.includes("failed")) return "failed";
  return "passed";
}

function decodePointerSegment(part: string): string | undefined {
  let decoded = "";
  for (let index = 0; index < part.length; index += 1) {
    const char = part[index];
    if (char !== "~") {
      decoded += char;
      continue;
    }
    const next = part[index + 1];
    if (next === "0") {
      decoded += "~";
      index += 1;
      continue;
    }
    if (next === "1") {
      decoded += "/";
      index += 1;
      continue;
    }
    return undefined;
  }
  return decoded;
}

function isArrayIndex(value: string): boolean {
  return value === "0" || /^[1-9]\d*$/.test(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }

  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (!deepEqual(leftKeys, rightKeys)) return false;
    return leftKeys.every((key) => deepEqual(left[key], right[key]));
  }

  return false;
}

function normalizeProbe(
  probe: HttpProbeSpec,
  env: Record<string, string | undefined>,
): { probe: NormalizedProbe; error?: undefined } | { probe: { evidence: HttpProbeEvidence }; error: ProbeError } {
  const method = probe.method ?? "GET";
  const endpoint = sanitizeEndpoint(probe.url);
  const evidence: HttpProbeEvidence = { endpoint, method: method === "HEAD" ? "HEAD" : "GET", durationMs: 0 };

  if (method !== "GET" && method !== "HEAD") {
    return { probe: { evidence }, error: { code: "invalid_probe_method", message: "HTTP probes support only GET and HEAD." } };
  }

  let url: URL;
  try {
    url = new URL(probe.url);
  } catch {
    return { probe: { evidence }, error: { code: "invalid_probe_url", message: "HTTP probe URL is invalid." } };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { probe: { evidence }, error: { code: "invalid_probe_url", message: "HTTP probe URL must use http or https." } };
  }
  if (url.username || url.password) {
    return { probe: { evidence }, error: { code: "invalid_probe_url", message: "HTTP probe URL must not include username or password credentials." } };
  }

  const headers: Record<string, string> = { ...(probe.headers ?? {}) };
  for (const [header, envName] of Object.entries(probe.headersFromEnv ?? {})) {
    const value = env[envName];
    if (!value) {
      return {
        probe: { evidence },
        error: { code: "probe_missing_secret", message: `Environment variable ${envName} is required for probe header ${header}.` },
      };
    }
    headers[header] = value;
  }

  const timeoutMs = probe.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { probe: { evidence }, error: { code: "invalid_probe_timeout", message: "HTTP probe timeoutMs must be a positive number." } };
  }
  const notFoundStatuses = probe.notFoundStatuses ?? [];
  if (!notFoundStatuses.every(isAbsenceStatus)) {
    return {
      probe: { evidence },
      error: { code: "invalid_probe_not_found_statuses", message: "HTTP probe notFoundStatuses must contain HTTP 4xx/5xx status codes." },
    };
  }

  return {
    probe: {
      url,
      method,
      timeoutMs,
      headers,
      notFoundStatuses,
      evidence,
    },
  };
}

function withProbeTiming(evidence: HttpProbeEvidence, started: number, response: Response): HttpProbeEvidence {
  const contentType = response.headers.get("content-type") ?? undefined;
  return omitUndefined({
    ...evidence,
    status: response.status,
    durationMs: Math.max(0, Date.now() - started),
    contentType,
  });
}

async function parseProbeBody(
  response: Response,
  method: "GET" | "HEAD",
  signal: AbortSignal,
): Promise<{ value: JsonValue; error?: undefined } | { error: ProbeError }> {
  if (method === "HEAD" || response.status === 204 || response.status === 205) {
    return { value: null };
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await readResponseText(response, signal);
  if (!text) {
    return { value: null };
  }

  if (isJsonContentType(contentType)) {
    try {
      const value = JSON.parse(text) as unknown;
      if (!isJsonValue(value)) {
        return { error: { code: "probe_invalid_json", message: "HTTP probe JSON body is not a serializable JSON value." } };
      }
      return { value };
    } catch {
      return { error: { code: "probe_invalid_json", message: "HTTP probe returned malformed JSON." } };
    }
  }

  if (contentType.startsWith("text/")) {
    return { value: text };
  }

  return {
    error: {
      code: "probe_unsupported_content_type",
      message: "HTTP probe response must be JSON, text, empty, or a HEAD response.",
    },
  };
}

function isJsonContentType(contentType: string): boolean {
  return /\bapplication\/json\b/i.test(contentType) || /\+json\b/i.test(contentType);
}

function readResponseText(response: Response, signal: AbortSignal): Promise<string> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }

  let removeAbortListener: (() => void) | undefined;
  const body = response.text();
  body.catch(() => undefined);
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => {
      try {
        response.body?.cancel().catch(() => undefined);
      } catch {
        // Response.text() may already own the stream lock in some runtimes.
      }
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });

  return Promise.race([body, aborted]).finally(() => {
    removeAbortListener?.();
  });
}

function probeError(
  id: string | undefined,
  probe: HttpProbeEvidence,
  code: string,
  message: string,
): HttpAssertionCheckResult {
  return {
    id,
    verdict: "error",
    probe,
    assertions: [],
    error: { code, message },
  };
}

function sanitizeEndpoint(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "<invalid-url>";
    }
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      url.searchParams.set(key, "REDACTED");
    }
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}

function parseAssertionConfig(
  config: unknown,
): { config: Required<Pick<AssertionConfig, "assertions">> & AssertionConfig & { observation: StateObservation }; error?: undefined; id?: string }
  | { error: ProbeError; id?: string } {
  if (!isRecord(config)) {
    return { error: { code: "invalid_config", message: "Assertion config must be an object." } };
  }

  const id = typeof config["id"] === "string" ? config["id"] : undefined;
  const assertions = parseAssertions(config["assertions"]);
  if (assertions.error) {
    return { id, error: assertions.error };
  }

  if (config["probe"] !== undefined) {
    if (!isRecord(config["probe"])) {
      return { id, error: { code: "invalid_config", message: "probe must be an object." } };
    }
    const probe = parseProbeSpec(config["probe"]);
    if (probe.error) return { id, error: probe.error };
    return {
      id,
      config: {
        id,
        probe: probe.probe,
        assertions: assertions.assertions,
        observation: { found: false },
      },
    };
  }

  const observation = parseObservation(config["observation"]);
  if (observation.error) {
    return { id, error: observation.error };
  }

  return {
    id,
    config: {
      id,
      observation: observation.observation,
      assertions: assertions.assertions,
    },
  };
}

function parseAssertions(value: unknown): { assertions: StateAssertion[]; error?: undefined } | { error: ProbeError } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: { code: "invalid_assertion", message: "assertions must be a non-empty array." } };
  }

  const assertions: StateAssertion[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return { error: { code: "invalid_assertion", message: "Each assertion must be an object." } };
    }
    const base = parseAssertionBase(item);
    if (base.error) return { error: base.error };
    const op = item["op"];
    if (op === "exists" || op === "not_exists" || op === "no_duplicate") {
      assertions.push({ op, ...base.base });
      continue;
    }
    if (op === "equals" || op === "contains") {
      if (!Object.prototype.hasOwnProperty.call(item, "expected") || !isJsonValue(item["expected"])) {
        return { error: { code: "invalid_assertion", message: `${op} requires a serializable JSON expected value.` } };
      }
      assertions.push({ op, expected: item["expected"], ...base.base });
      continue;
    }
    if (op === "latency_threshold") {
      const maxMs = item["maxMs"];
      if (typeof maxMs !== "number" || !Number.isFinite(maxMs) || maxMs < 0) {
        return { error: { code: "invalid_assertion", message: "latency_threshold requires a non-negative maxMs." } };
      }
      assertions.push({ op, maxMs, ...base.base });
      continue;
    }
    return { error: { code: "invalid_assertion", message: `Unknown assertion op: ${String(op)}.` } };
  }

  return { assertions };
}

function parseAssertionBase(
  item: Record<string, unknown>,
): { base: { pointer?: string; label?: string }; error?: undefined } | { error: ProbeError } {
  const pointer = item["pointer"];
  const label = item["label"];
  if (pointer !== undefined && typeof pointer !== "string") {
    return { error: { code: "invalid_assertion", message: "assertion pointer must be a string when provided." } };
  }
  if (label !== undefined && typeof label !== "string") {
    return { error: { code: "invalid_assertion", message: "assertion label must be a string when provided." } };
  }
  return { base: omitUndefined({ pointer, label }) };
}

function parseProbeSpec(value: Record<string, unknown>): { probe: HttpProbeSpec; error?: undefined } | { error: ProbeError } {
  if (typeof value["url"] !== "string" || !value["url"]) {
    return { error: { code: "invalid_config", message: "probe.url is required." } };
  }
  const method = value["method"];
  if (method !== undefined && method !== "GET" && method !== "HEAD") {
    return { error: { code: "invalid_probe_method", message: "probe.method must be GET or HEAD." } };
  }
  if (value["headers"] !== undefined) {
    return {
      error: {
        code: "literal_probe_headers_disallowed",
        message: "Literal probe headers are not allowed in assertion config files. Use headersFromEnv instead.",
      },
    };
  }
  const headersFromEnv = parseStringRecord(value["headersFromEnv"]);
  if (headersFromEnv.error) return { error: headersFromEnv.error };
  const notFoundStatuses = parseStatusArray(value["notFoundStatuses"]);
  if (notFoundStatuses.error) return { error: notFoundStatuses.error };
  const timeoutMs = value["timeoutMs"];
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    return { error: { code: "invalid_probe_timeout", message: "probe.timeoutMs must be a positive number." } };
  }
  return {
    probe: omitUndefined({
      url: value["url"],
      method,
      headersFromEnv: headersFromEnv.record,
      notFoundStatuses: notFoundStatuses.statuses,
      timeoutMs,
    }) as HttpProbeSpec,
  };
}

function parseStatusArray(value: unknown): { statuses?: number[]; error?: undefined } | { error: ProbeError } {
  if (value === undefined) return {};
  if (!Array.isArray(value) || !value.every(isAbsenceStatus)) {
    return {
      error: {
        code: "invalid_probe_not_found_statuses",
        message: "probe.notFoundStatuses must contain HTTP 4xx/5xx status codes.",
      },
    };
  }
  return { statuses: value };
}

function parseStringRecord(value: unknown): { record?: Record<string, string>; error?: undefined } | { error: ProbeError } {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    return { error: { code: "invalid_config", message: "Header maps must be objects with string values." } };
  }
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      return { error: { code: "invalid_config", message: "Header maps must be objects with string values." } };
    }
    record[key] = item;
  }
  return { record };
}

function parseObservation(value: unknown): { observation: StateObservation; error?: undefined } | { error: ProbeError } {
  if (!isRecord(value)) {
    return { error: { code: "invalid_config", message: "observation must be provided when probe is omitted." } };
  }
  if (typeof value["found"] !== "boolean") {
    return { error: { code: "invalid_config", message: "observation.found must be a boolean." } };
  }
  if (value["value"] !== undefined && !isJsonValue(value["value"])) {
    return { error: { code: "invalid_config", message: "observation.value must be a serializable JSON value." } };
  }
  const latencyMs = value["latencyMs"];
  if (latencyMs !== undefined && (typeof latencyMs !== "number" || !Number.isFinite(latencyMs))) {
    return { error: { code: "invalid_config", message: "observation.latencyMs must be a finite number when provided." } };
  }
  return {
    observation: omitUndefined({
      found: value["found"],
      value: value["value"],
      latencyMs,
    }) as StateObservation,
  };
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function isAbsenceStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 400 && status <= 599;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
