import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizePathTemplate, scanDirectory, sortEndpoints } from "../dist/scan.js";
import { fromOpenApi } from "../dist/importers.js";
import { PremanConfigError } from "../dist/errors.js";
import * as main from "../dist/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixture(name) {
  return join(FIXTURES, name);
}

/**
 * Every tree exercising router mount resolution, one behaviour each. Listed apart so
 * the mount-only invariants can name them, and folded into `SCANNABLE_FIXTURES` below
 * so they carry every suite-wide invariant too.
 */
const MOUNT_FIXTURES = [
  "mount-express-single",
  "mount-express-nested",
  "mount-express-twice",
  "mount-express-cycle",
  "mount-express-dynamic-prefix",
  "mount-express-unresolvable-import",
  "mount-express-unmounted",
  "mount-express-index",
  "mount-fastapi-single",
  "mount-fastapi-nested",
  "mount-fastapi-dotted",
  "mount-fastapi-two-routers",
  "mount-fastapi-dynamic-prefix",
  "mount-fastapi-package",
  "mount-express-bare-multi",
  "mount-express-dotted-target",
  "mount-express-computed-prefix",
  "mount-express-array-prefix",
  "mount-express-exported-app",
  "mount-express-app-parameter",
  "mount-express-typescript",
  "mount-express-barrel",
  "mount-express-route-table",
  "mount-express-route-table-variants",
  "mount-express-route-table-dynamic",
  "mount-fastapi-bare-multi",
  "mount-fastapi-computed-prefix",
  "mount-fastapi-long-router-call",
  "mount-fastapi-factory",
  "mount-fastapi-aggregator",
];

/**
 * Every fixture tree that scans successfully. Used by the whole-suite invariants
 * so a new fixture cannot quietly opt out of them.
 */
const SCANNABLE_FIXTURES = [
  "fastapi-app",
  "express-app",
  "express-receivers",
  "express-decoys",
  "express-chain",
  "express-template",
  "express-yaml-spec",
  "fastapi-decoys",
  "fastapi-methods",
  "express-test-files",
  "spec-secrets",
  "scan-cap",
  ...MOUNT_FIXTURES,
];

/**
 * The only trees holding a mount that cannot be followed, and how many entries each
 * reports. Every other tree in `SCANNABLE_FIXTURES` must report none: an unresolved
 * mount is a claim that something was left unread, so one appearing anywhere else is
 * a regression, not noise.
 *
 * The count is stated per tree rather than merely allowed to be non-zero. A tree that
 * flags one mount too few has gone quiet about a prefix it could not read, and a tree
 * that flags one too many is crying off a mount it actually followed; neither shows up
 * against a bare "non-empty" check.
 */
const UNRESOLVED_MOUNT_COUNTS = {
  "mount-express-cycle": 1,
  "mount-express-dynamic-prefix": 1,
  "mount-express-unresolvable-import": 1,
  "mount-fastapi-dynamic-prefix": 1,
  // Two unreadable prefixes in one file: one concatenated, one interpolated.
  "mount-express-computed-prefix": 2,
  // One on the `include_router` call, one on the router's own constructor.
  "mount-fastapi-computed-prefix": 2,
  // The router parameter of an exported function: its prefix lives in the caller.
  "mount-express-app-parameter": 1,
  // One table row whose path is not a literal. The sibling row is followed.
  "mount-express-route-table-dynamic": 1,
};

/** Every endpoint `fastapi-app/` must produce, in `sortEndpoints()` order. */
const FASTAPI_ENDPOINTS = [
  { method: "GET", path_template: "/api/v1/items/{item_id}", source_location: "routers/items.py:8", confidence: 0.9 },
  { method: "PUT", path_template: "/api/v1/items/{item_id}", source_location: "routers/items.py:13", confidence: 0.9 },
  { method: "GET", path_template: "/api/v1/users", source_location: "routers/users.py:8", confidence: 0.9 },
  { method: "DELETE", path_template: "/api/v1/users/{user_id}", source_location: "routers/users.py:18", confidence: 0.9 },
  { method: "GET", path_template: "/api/v1/users/{user_id}", source_location: "routers/users.py:13", confidence: 0.9 },
  { method: "GET", path_template: "/health", source_location: "main.py:13", confidence: 0.9 },
  { method: "GET", path_template: "/legacy", source_location: "main.py:28", confidence: 0.9 },
  { method: "POST", path_template: "/legacy", source_location: "main.py:28", confidence: 0.9 },
  {
    method: "GET",
    path_template: "/reports/summary",
    source_location: "openapi.json",
    confidence: 1,
    tags: ["reports"],
  },
  {
    method: "POST",
    path_template: "/users",
    source_location: "main.py:23",
    confidence: 1,
    tags: ["users"],
    // `openapi.json` states a requestBody for this operation, so the merged endpoint
    // carries it verbatim — the same schema `preman import openapi --file` emits.
    request_body_schema: {
      type: "object",
      properties: { email: { type: "string" }, name: { type: "string" } },
      required: ["email"],
    },
  },
  {
    method: "GET",
    path_template: "/users/{user_id}",
    source_location: "main.py:18",
    confidence: 1,
    tags: ["users"],
  },
];

/** Every endpoint `express-app/` must produce, in `sortEndpoints()` order. */
const EXPRESS_ENDPOINTS = [
  { method: "DELETE", path_template: "/health", source_location: "app.js:25", confidence: 0.9 },
  { method: "GET", path_template: "/health", source_location: "app.js:25", confidence: 0.9 },
  { method: "PATCH", path_template: "/health", source_location: "app.js:25", confidence: 0.9 },
  { method: "POST", path_template: "/health", source_location: "app.js:25", confidence: 0.9 },
  { method: "PUT", path_template: "/health", source_location: "app.js:25", confidence: 0.9 },
  { method: "GET", path_template: "/status", source_location: "app.js:21", confidence: 0.9 },
  { method: "GET", path_template: "/things", source_location: "routes/things.js:15", confidence: 0.9 },
  { method: "POST", path_template: "/things", source_location: "routes/things.js:15", confidence: 0.9 },
  { method: "POST", path_template: "/users", source_location: "routes/users.js:6", confidence: 0.9 },
  { method: "DELETE", path_template: "/users/{id}", source_location: "app.js:17", confidence: 0.9 },
  { method: "GET", path_template: "/users/{id}", source_location: "app.js:13", confidence: 0.9 },
  { method: "PATCH", path_template: "/users/{id}", source_location: "routes/users.js:10", confidence: 0.9 },
];

/**
 * The values planted in `spec-secrets/openapi.json`'s request body schema. A spec's
 * schema is emitted verbatim, exactly as `preman import openapi --file` emits it, so
 * every one of these reaches the output unredacted.
 */
const SPEC_BODY_VALUES = [
  "pm_live_FAKEinDescription",
  "pm_live_FAKEinExample",
  "pm_live_FAKEinDefault",
  "pm_live_FAKEinEnum",
];

/**
 * The values planted on that spec's query parameter. `fromOpenApi` emits no query
 * schema, so scan has none to carry and these never appear.
 */
const SPEC_QUERY_VALUES = [
  "pm_test_FAKEinQueryExample",
  "pm_test_FAKEinQueryDefault",
];

function endpointFor(result, method, pathTemplate) {
  const found = result.endpoints.filter(
    (endpoint) => endpoint.method === method && endpoint.path_template === pathTemplate,
  );
  assert.equal(found.length, 1, `expected exactly one ${method} ${pathTemplate}`);
  return found[0];
}

/**
 * The `requestBodySchema` `preman import openapi --file` emits for one operation of a
 * fixture spec. Scan must produce exactly this, so the two commands agree on one input.
 */
function importedBodySchema(fixtureName, method, pathTemplate) {
  const specText = readFileSync(join(fixture(fixtureName), "openapi.json"), "utf8");
  const found = fromOpenApi(specText).filter(
    (endpoint) => endpoint.method === method && normalizePathTemplate(endpoint.path) === pathTemplate,
  );
  assert.equal(found.length, 1, `expected exactly one ${method} ${pathTemplate} in ${fixtureName}/openapi.json`);
  return found[0].requestBodySchema;
}

/** Asserts the scan fails loudly and hands the message back for content assertions. */
function scanFailure(name) {
  let thrown;
  try {
    scanDirectory({ dir: fixture(name) });
    thrown = undefined;
  } catch (error) {
    thrown = error;
  }
  assert.equal(
    thrown instanceof PremanConfigError,
    true,
    `${name} must throw PremanConfigError, not return an empty endpoint list`,
  );
  return thrown;
}

function routes(result) {
  return result.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path_template}`);
}

test("scans the FastAPI fixture tree into the full expected endpoint set", () => {
  const result = scanDirectory({ dir: fixture("fastapi-app") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  assert.deepEqual(result.specs, ["openapi.json"]);
  assert.deepEqual(result.unsupportedSpecs, []);
  assert.equal(result.truncated, false);
  assert.equal(result.fileCount, 7);
  assert.equal(result.dir, fixture("fastapi-app"));
  assert.equal(result.endpoints.length, 11);
  assert.deepEqual(result.endpoints, FASTAPI_ENDPOINTS);
});

test("scans the Express fixture tree into the full expected endpoint set", () => {
  const result = scanDirectory({ dir: fixture("express-app") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.deepEqual(result.specs, []);
  assert.deepEqual(result.unsupportedSpecs, []);
  assert.equal(result.truncated, false);
  assert.equal(result.fileCount, 4);
  assert.equal(result.dir, fixture("express-app"));
  assert.equal(result.endpoints.length, 12);
  assert.deepEqual(result.endpoints, EXPRESS_ENDPOINTS);
});

test("app.all fans out to exactly the five write-and-read methods on one line", () => {
  const result = scanDirectory({ dir: fixture("express-app") });
  const health = result.endpoints.filter((endpoint) => endpoint.path_template === "/health");

  assert.deepEqual(health.map((endpoint) => endpoint.method), ["DELETE", "GET", "PATCH", "POST", "PUT"]);
  assert.deepEqual([...new Set(health.map((endpoint) => endpoint.source_location))], ["app.js:25"]);
  assert.equal(health.some((endpoint) => endpoint.method === "HEAD"), false);
  assert.equal(health.some((endpoint) => endpoint.method === "OPTIONS"), false);
});

test("an unsupported tree throws PremanConfigError naming the adapters tried", () => {
  const dir = fixture("unknown-app");

  const thrown = scanFailure("unknown-app");
  assert.equal(thrown.name, "PremanConfigError");
  assert.equal(thrown.code, "config_error");
  assert.equal(
    thrown.message,
    `No adapter matched ${dir}. Tried: fastapi, express. `
    + "No committed OpenAPI or Swagger spec was found either.",
  );
  assert.match(thrown.message, /Tried: fastapi, express/);

  assert.throws(() => scanDirectory({ dir }), PremanConfigError);
});

test("a commented route in a file with no express import is never discovered", () => {
  const result = scanDirectory({ dir: fixture("express-app") });

  assert.equal(result.endpoints.some((endpoint) => endpoint.path_template === "/not-a-route"), false);
  assert.equal(
    result.endpoints.some((endpoint) => endpoint.source_location.startsWith("lib/format.js")),
    false,
  );
  assert.equal(JSON.stringify(result).includes("not-a-route"), false);
});

test("express decoys in comments and strings are dropped beside a real route in the same file", () => {
  const result = scanDirectory({ dir: fixture("express-decoys") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.deepEqual(routes(result), ["GET /real"]);
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/real", source_location: "routes.js:14", confidence: 0.9 },
  ]);

  const json = JSON.stringify(result);
  assert.equal(json.includes("commented-out"), false);
  assert.equal(json.includes("block-commented"), false);
  assert.equal(json.includes("in-a-string"), false);
  assert.equal(json.includes("in-another-string"), false);
});

test("FastAPI decoys in # comments and docstrings are dropped beside a real route in the same file", () => {
  const result = scanDirectory({ dir: fixture("fastapi-decoys") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  assert.deepEqual(routes(result), ["GET /real"]);
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/real", source_location: "app.py:15", confidence: 0.9 },
  ]);

  const json = JSON.stringify(result);
  assert.equal(json.includes("commented-out"), false);
  assert.equal(json.includes("also-commented-out"), false);
  assert.equal(json.includes("module-docstring"), false);
  assert.equal(json.includes("handler-docstring"), false);
});

test("only a variable assigned from express carries routes", () => {
  const result = scanDirectory({ dir: fixture("express-receivers") });

  assert.deepEqual(routes(result), ["GET /real"]);
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/real", source_location: "app.js:6", confidence: 0.9 },
  ]);

  const json = JSON.stringify(result);
  assert.equal(json.includes("some-cache-key"), false);
  assert.equal(json.includes("another-key"), false);
  assert.equal(json.includes("api.example.com"), false);
  assert.equal(json.includes("/v1/remote"), false);
});

test("a .route() chain stops at its own expression and does not reach the next statement", () => {
  const result = scanDirectory({ dir: fixture("express-chain") });

  assert.deepEqual(routes(result), ["GET /chain", "POST /chain"]);
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/chain", source_location: "router.js:8", confidence: 0.9 },
    { method: "POST", path_template: "/chain", source_location: "router.js:8", confidence: 0.9 },
  ]);
  assert.equal(JSON.stringify(result).includes("leaked"), false);
});

test("api_route keeps only methods that are real HTTP methods", () => {
  const result = scanDirectory({ dir: fixture("fastapi-methods") });

  assert.deepEqual(routes(result), ["GET /brew"]);
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/brew", source_location: "app.py:6", confidence: 0.9 },
  ]);
  assert.equal(JSON.stringify(result).includes("BREW"), false);
});

test("a template literal path becomes a named placeholder, never a raw interpolation", () => {
  const result = scanDirectory({ dir: fixture("express-template") });

  assert.deepEqual(routes(result), ["PUT /tpl-{version}/users"]);
  assert.deepEqual(result.endpoints, [
    { method: "PUT", path_template: "/tpl-{version}/users", source_location: "app.js:6", confidence: 0.9 },
  ]);

  const json = JSON.stringify(result);
  assert.equal(json.includes("${"), false);
  assert.equal(json.includes("`"), false);
});

test("a router mounted in another file is reported at the path the server answers on", () => {
  const result = scanDirectory({ dir: fixture("mount-express-single") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.specs, []);
  assert.deepEqual(result.unresolvedMounts, []);
  // `routes/users.js` writes `/users` and `/users/:id`; `app.js:9` mounts the router at
  // `/api/v1`, so neither written path is a path the server answers on. `source_location`
  // stays on the line that declared the route, not the line that mounted it.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/v1/users", source_location: "routes/users.js:7", confidence: 0.9 },
    { method: "GET", path_template: "/api/v1/users/{id}", source_location: "routes/users.js:9", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "app.js:11", confidence: 0.9 },
  ]);
  // The app's own route is not touched by a mount it is not under.
  assert.equal(JSON.stringify(result.endpoints).includes("/api/v1/health"), false);
});

test("two levels of mount chain their prefixes outermost first", () => {
  const result = scanDirectory({ dir: fixture("mount-express-nested") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 3);
  assert.deepEqual(result.unresolvedMounts, []);
  // `app.js:8` mounts `v1` at `/api`, `v1.js:9` mounts `users` at `/users`. The order is
  // the one Express applies: the outer prefix leads, so `/api/users/...` and never
  // `/users/api/...`.
  assert.deepEqual(result.endpoints, [
    { method: "POST", path_template: "/api/users/invite", source_location: "routes/users.js:9", confidence: 0.9 },
    { method: "GET", path_template: "/api/users/profile", source_location: "routes/users.js:7", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "app.js:10", confidence: 0.9 },
  ]);
  assert.equal(JSON.stringify(result.endpoints).includes("/users/api/"), false);
});

test("a router mounted twice is reported at both prefixes, neither deduped away", () => {
  const result = scanDirectory({ dir: fixture("mount-express-twice") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.unresolvedMounts, []);
  // One `router.get` line, two live mounts, so two endpoints. They share a
  // `source_location`, which is exactly what a naive dedupe would collapse.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/ping", source_location: "routes/ping.js:7", confidence: 0.9 },
    { method: "GET", path_template: "/internal/ping", source_location: "routes/ping.js:7", confidence: 0.9 },
  ]);
  assert.deepEqual(
    [...new Set(result.endpoints.map((endpoint) => endpoint.source_location))],
    ["routes/ping.js:7"],
    "both endpoints must come from the one declaring line",
  );
  assert.equal(result.endpoints.length, 2, "the second mount must survive the merge, not be folded into the first");
});

test("a mount loop terminates, marks its routes uncertain, and reports the edge that closed it", () => {
  const result = scanDirectory({ dir: fixture("mount-express-cycle") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 2);
  // Reaching here at all is half the assertion: `a.js:11` mounts `b` and `b.js:11`
  // mounts `a`, so an unguarded walk would not return.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/a/a-route", source_location: "a.js:9", confidence: 0.5 },
    { method: "GET", path_template: "/a/b/b-route", source_location: "b.js:9", confidence: 0.5 },
  ]);
  // Every prefix on offer came from an arbitrary break in the loop, so no path here is
  // defensible and both endpoints drop to 0.5 — not the 0.9 an ordinary mount keeps.
  assert.deepEqual([...new Set(result.endpoints.map((endpoint) => endpoint.confidence))], [0.5]);

  assert.equal(result.unresolvedMounts.length, 1, "the loop must be reported once, not once per lap");
  assert.deepEqual(result.unresolvedMounts[0], {
    path: "a.js",
    target: "b",
    reason: "Mount loops back to a router that already mounts this one. Every prefix on "
      + "offer comes from an arbitrary break in that loop, so routes reachable only "
      + "through it are reported at the path they were written with.",
  });
  // The edge named is the one that closed the loop — the second visit to a router
  // already on the path, not the first mount encountered.
  assert.deepEqual(Object.keys(result.unresolvedMounts[0]).sort(), ["path", "reason", "target"]);
});

test("an unreadable Express mount prefix lowers only the mounted routes' confidence", () => {
  const result = scanDirectory({ dir: fixture("mount-express-dynamic-prefix") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 2);
  // `app.js:11` is `app.use(basePath, reportsRouter)`. The prefix exists but cannot be
  // read, so the route is reported at the only path that can be defended, at 0.5.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/health", source_location: "app.js:13", confidence: 0.9 },
    { method: "GET", path_template: "/reports", source_location: "routes/reports.js:7", confidence: 0.5 },
  ]);
  // The point of the fixture: the drop is per-endpoint. A route declared directly on the
  // app, in the same file as the unreadable mount, keeps full confidence.
  assert.equal(endpointFor(result, "GET", "/health").confidence, 0.9);
  assert.equal(endpointFor(result, "GET", "/reports").confidence, 0.5);

  assert.deepEqual(result.unresolvedMounts, [
    {
      path: "app.js",
      target: "reportsRouter",
      reason: "Mount prefix is not a literal, so these routes are reported without it.",
    },
  ]);
  // No prefix is guessed at from the variable's name or its value.
  assert.equal(JSON.stringify(result.endpoints).includes("basePath"), false);
  assert.equal(JSON.stringify(result.endpoints).includes("API_BASE"), false);
});

test("a mount whose import does not resolve invents no path and quotes the specifier", () => {
  const result = scanDirectory({ dir: fixture("mount-express-unresolvable-import") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 1);
  // `./routes/ghost` is not in this tree, so nothing is known about what it exports.
  // The mount is reported; no endpoint is conjured for the router behind it.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/health", source_location: "app.js:11", confidence: 0.9 },
  ]);
  assert.equal(
    result.endpoints.some((endpoint) => endpoint.path_template.startsWith("/ghost")),
    false,
    "an unfollowable mount must not produce an endpoint of its own",
  );

  assert.deepEqual(result.unresolvedMounts, [
    {
      path: "app.js",
      target: "ghostRouter",
      reason: "Mounted from ./routes/ghost, which did not resolve to a scanned file exporting a router.",
    },
  ]);
  // The specifier is quoted as written, so a reader can grep the source for it.
  assert.equal(result.unresolvedMounts[0].reason.includes("./routes/ghost"), true);
});

test("a router nobody mounts reports its routes exactly as written", () => {
  const result = scanDirectory({ dir: fixture("mount-express-unmounted") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 2);
  // Mounts relocate routes that were already found; they never gate them. A router with
  // no incoming mount keeps the path beside its handler, at full confidence.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/health", source_location: "app.js:7", confidence: 0.9 },
    { method: "GET", path_template: "/orphan", source_location: "routes/orphan.js:7", confidence: 0.9 },
  ]);
  assert.deepEqual(result.unresolvedMounts, [], "nothing was mounted, so nothing failed to resolve");
});

test("a directory specifier resolves through that directory's index file", () => {
  const result = scanDirectory({ dir: fixture("mount-express-index") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.unresolvedMounts, []);
  // `require('./routes/users')` names a directory; the router lives in
  // `routes/users/index.js`, which is where Node itself would look.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/users", source_location: "routes/users/index.js:6", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "app.js:11", confidence: 0.9 },
  ]);
});

test("include_router across files prefixes the router and keeps FastAPI's parameter names", () => {
  const result = scanDirectory({ dir: fixture("mount-fastapi-single") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.specs, []);
  assert.deepEqual(result.unresolvedMounts, []);
  // `main.py:10` includes `users_router` at `/api/v1`, reached through
  // `from .routers.users import router as users_router` — the alias is what the mount names.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/v1/users", source_location: "routers/users.py:9", confidence: 0.9 },
    { method: "GET", path_template: "/api/v1/users/{user_id}", source_location: "routers/users.py:14", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "main.py:13", confidence: 0.9 },
  ]);
  // Normalization keeps the declared parameter name; it does not collapse it to `{id}`.
  assert.equal(JSON.stringify(result.endpoints).includes("{user_id}"), true);
  assert.equal(result.endpoints.some((endpoint) => endpoint.path_template.endsWith("/{id}")), false);
});

test("nested include_router chains both prefixes outermost first", () => {
  const result = scanDirectory({ dir: fixture("mount-fastapi-nested") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  assert.equal(result.fileCount, 3);
  assert.deepEqual(result.unresolvedMounts, []);
  // `main.py:9` includes `v1` at `/api`; `v1.py:10` includes `users` at `/users`.
  assert.deepEqual(result.endpoints, [
    { method: "POST", path_template: "/api/users/invite", source_location: "routers/users.py:14", confidence: 0.9 },
    { method: "GET", path_template: "/api/users/profile", source_location: "routers/users.py:9", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "main.py:12", confidence: 0.9 },
  ]);
  assert.equal(JSON.stringify(result.endpoints).includes("/users/api/"), false);
});

test("a dotted include_router target resolves through the imported module", () => {
  const result = scanDirectory({ dir: fixture("mount-fastapi-dotted") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.unresolvedMounts, []);
  // `from .routers import users` then `include_router(users.router, prefix="/api/v1")` —
  // the layout FastAPI's own docs teach. The binding mounted is the attribute, not the module.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/v1/users", source_location: "routers/users.py:9", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "main.py:13", confidence: 0.9 },
  ]);
});

test("a dotted target prefixes only the router it names, not its module neighbours", () => {
  const result = scanDirectory({ dir: fixture("mount-fastapi-two-routers") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.unresolvedMounts, []);
  // `routers/multi.py` declares `router_a` and `router_b`; `main.py:10` includes only
  // `multi.router_a` at `/api`. Without the attribute narrowing the mount, `/beta` would
  // pick the prefix up too.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/alpha", source_location: "routers/multi.py:11", confidence: 0.9 },
    { method: "GET", path_template: "/beta", source_location: "routers/multi.py:16", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "main.py:13", confidence: 0.9 },
  ]);
  assert.equal(result.endpoints.some((endpoint) => endpoint.path_template === "/api/beta"), false);
});

test("an unreadable include_router prefix lowers only the included router's confidence", () => {
  const result = scanDirectory({ dir: fixture("mount-fastapi-dynamic-prefix") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  assert.equal(result.fileCount, 2);
  // `main.py:12` is `include_router(reports_router, prefix=API_PREFIX)`. The constant is a
  // literal four lines above, but constants are not folded, so the prefix is unreadable.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/health", source_location: "main.py:15", confidence: 0.9 },
    { method: "GET", path_template: "/reports", source_location: "routers/reports.py:9", confidence: 0.5 },
  ]);
  assert.equal(endpointFor(result, "GET", "/health").confidence, 0.9);
  assert.equal(endpointFor(result, "GET", "/reports").confidence, 0.5);

  assert.deepEqual(result.unresolvedMounts, [
    {
      path: "main.py",
      target: "reports_router",
      reason: "Mount prefix is not a literal, so these routes are reported without it.",
    },
  ]);
  // The unread value is never guessed at, even though it is a literal in the same file.
  assert.equal(JSON.stringify(result.endpoints).includes("/api/reports"), false);
  assert.equal(JSON.stringify(result.endpoints).includes("API_PREFIX"), false);
});

test("a package directory specifier resolves to the module inside the package", () => {
  const result = scanDirectory({ dir: fixture("mount-fastapi-package") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  // `routers/__init__.py` is read and counted, but imports no fastapi, so it contributes
  // no routes of its own.
  assert.equal(result.fileCount, 3);
  assert.deepEqual(result.unresolvedMounts, []);
  // `from .routers import users` where `.routers` is a package directory: resolution must
  // reach `routers/users.py`, the file that actually exports the mounted binding.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/v2/users", source_location: "routers/users.py:8", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "main.py:13", confidence: 0.9 },
  ]);
  assert.equal(
    result.endpoints.some((endpoint) => endpoint.source_location.startsWith("routers/__init__.py")),
    false,
  );
});

test("a bare Express mount target moves only the router it names", () => {
  const result = scanDirectory({ dir: fixture("mount-express-bare-multi") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.unresolvedMounts, []);
  // `routes/all.js` exports `usersRouter` and `adminRouter`; `app.js` mounts one at
  // `/api` and the other at `/internal`. Taking every export in the file for each mount
  // yields two more endpoints than the server has, at full confidence.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/users", source_location: "routes/all.js:10", confidence: 0.9 },
    { method: "GET", path_template: "/internal/dashboard", source_location: "routes/all.js:12", confidence: 0.9 },
  ]);
  assert.equal(result.endpoints.length, 2, "neither mount may pick up the other mount's router");
  const paths = result.endpoints.map((endpoint) => endpoint.path_template);
  assert.equal(paths.includes("/api/dashboard"), false, "the users mount reached the admin router");
  assert.equal(paths.includes("/internal/users"), false, "the admin mount reached the users router");
});

test("a dotted Express target resolves through the module it is read off", () => {
  const result = scanDirectory({ dir: fixture("mount-express-dotted-target") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.unresolvedMounts, []);
  // `app.use('/api', routes.usersRouter)` against `const routes = require('./routes')`.
  // The property names the router, so the mount resolves and narrows in one step: the
  // barrel's other export keeps the path it was written with.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/users", source_location: "routes/index.js:9", confidence: 0.9 },
    { method: "GET", path_template: "/dashboard", source_location: "routes/index.js:11", confidence: 0.9 },
  ]);
  assert.equal(result.endpoints.some((endpoint) => endpoint.path_template === "/api/dashboard"), false);
});

test("a bare FastAPI target imported by name mounts that router and no other", () => {
  const result = scanDirectory({ dir: fixture("mount-fastapi-bare-multi") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.unresolvedMounts, []);
  // `from .routers.multi import router_a` names one router in a module holding two, and
  // `include_router(router_a, prefix="/api")` mounts that one. `/beta` belongs to
  // `router_b`, which nothing includes, so it keeps the path beside its handler.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/alpha", source_location: "routers/multi.py:11", confidence: 0.9 },
    { method: "GET", path_template: "/beta", source_location: "routers/multi.py:16", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "main.py:13", confidence: 0.9 },
  ]);
  assert.equal(
    result.endpoints.some((endpoint) => endpoint.path_template === "/api/beta"),
    false,
    "the bare import must narrow the mount to router_a alone",
  );
});

test("a computed Express mount prefix is flagged rather than partly read", () => {
  const result = scanDirectory({ dir: fixture("mount-express-computed-prefix") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 3);
  // Both mounts open with a literal a careless read would take for the whole prefix.
  // `'/api/' + version` really mounts at `/api/v2`, and `` `/api/${version}` `` really
  // mounts at a fixed segment the server serves literally. Each is reported without a
  // prefix, at 0.5, while the route declared straight on the app keeps full confidence.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/audit", source_location: "routes/audit.js:5", confidence: 0.5 },
    { method: "GET", path_template: "/health", source_location: "app.js:18", confidence: 0.9 },
    { method: "GET", path_template: "/reports", source_location: "routes/reports.js:5", confidence: 0.5 },
  ]);

  assert.deepEqual(result.unresolvedMounts, [
    {
      path: "app.js",
      target: "reportsRouter",
      reason: "Mount prefix is not a literal, so these routes are reported without it.",
    },
    {
      path: "app.js",
      target: "auditRouter",
      reason: "Mount prefix is not a literal, so these routes are reported without it.",
    },
  ]);

  const json = JSON.stringify(result.endpoints);
  // The literal half of the concatenation is never published as the whole prefix.
  assert.equal(json.includes("/api/audit"), false);
  assert.equal(json.includes("/api/reports"), false);
  // A mount prefix interpolates to a fixed segment, so naming it `{version}` would
  // invite a caller to substitute into a hole the server does not have.
  assert.equal(json.includes("{version}"), false, "a mount prefix must never become a placeholder");
  assert.equal(json.includes("${"), false);
  assert.equal(json.includes("API_VERSION"), false);
});

test("an array of mount paths reports the router under every path in it", () => {
  const result = scanDirectory({ dir: fixture("mount-express-array-prefix") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.unresolvedMounts, [], "every path in the array is a readable literal");
  // `app.use(['/api', '/v2'], usersRouter)` is not one mount but two: Express answers on
  // both. Nothing is uncertain here, so neither endpoint drops below 0.9 — the array is
  // read, not merely noticed and given up on.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/users", source_location: "routes/users.js:5", confidence: 0.9 },
    { method: "GET", path_template: "/v2/users", source_location: "routes/users.js:5", confidence: 0.9 },
  ]);
  assert.deepEqual([...new Set(result.endpoints.map((endpoint) => endpoint.confidence))], [0.9]);
  assert.deepEqual(
    [...new Set(result.endpoints.map((endpoint) => endpoint.source_location))],
    ["routes/users.js:5"],
    "one declaring line, two live mounts, two endpoints",
  );
});

test("a computed FastAPI prefix is flagged on the include and on the router alike", () => {
  const result = scanDirectory({ dir: fixture("mount-fastapi-computed-prefix") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  assert.equal(result.fileCount, 3);
  // Two ways to state a prefix nobody can read. `include_router(..., prefix="/api/" +
  // VERSION)` is one; `APIRouter(prefix=AUDIT_PREFIX)` is the other, and it used to pass
  // silently at 0.9 because a router's own constructor was read as stating no prefix.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/events", source_location: "routers/audit.py:12", confidence: 0.5 },
    { method: "GET", path_template: "/health", source_location: "main.py:17", confidence: 0.9 },
    { method: "GET", path_template: "/reports", source_location: "routers/reports.py:6", confidence: 0.5 },
  ]);
  assert.equal(endpointFor(result, "GET", "/events").confidence, 0.5, "APIRouter(prefix=CONST) must not read as no prefix");
  assert.equal(endpointFor(result, "GET", "/health").confidence, 0.9);

  assert.deepEqual(result.unresolvedMounts, [
    {
      path: "main.py",
      target: "reports",
      reason: "Mount prefix is not a literal, so these routes are reported without it.",
    },
    {
      path: "routers/audit.py",
      target: "router#prefix",
      reason: "Mount prefix is not a literal, so these routes are reported without it.",
    },
  ]);

  const json = JSON.stringify(result.endpoints);
  assert.equal(json.includes("/api/reports"), false);
  assert.equal(json.includes("/audit/events"), false, "the constant's value is never folded in");
  assert.equal(json.includes("VERSION"), false);
  assert.equal(json.includes("AUDIT_PREFIX"), false);
});

test("a long APIRouter argument list still yields the literal prefix it states", () => {
  const result = scanDirectory({ dir: fixture("mount-fastapi-long-router-call") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.unresolvedMounts, [], "the prefix is readable, so nothing may be flagged");
  // `routers/catalog.py` states `prefix="/catalog"` first and then a `responses={...}`
  // block that runs the call past 400 characters. Giving up at the old bound lost the
  // prefix and reported these routes at the site root — a wrong path, at 0.9, unflagged.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/catalog/items", source_location: "routers/catalog.py:22", confidence: 0.9 },
    { method: "POST", path_template: "/api/catalog/items", source_location: "routers/catalog.py:27", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "main.py:13", confidence: 0.9 },
  ]);
  // Both prefixes survive and chain: the mount's `/api` and the router's own `/catalog`.
  assert.equal(result.endpoints.some((endpoint) => endpoint.path_template === "/api/items"), false);
  assert.equal(result.endpoints.some((endpoint) => endpoint.path_template === "/items"), false);
});

test("an application built inside a factory function carries its routes and mounts", () => {
  const result = scanDirectory({ dir: fixture("mount-fastapi-factory") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.unresolvedMounts, []);
  // Two headers sit on the line above a binding in `main.py`: the `-> FastAPI:` return
  // annotation of `create_app`, and an `if ENABLE_LEGACY:` clause. Reading either across
  // the newline captured a receiver named `FastAPI` or `ENABLE_LEGACY` and left the real
  // app and router carrying nothing — no routes, no mounts, from FastAPI's own idiom.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/users", source_location: "routers/users.py:6", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "main.py:27", confidence: 0.9 },
    { method: "GET", path_template: "/legacy/ping", source_location: "main.py:17", confidence: 0.9 },
  ]);
  // The app declared inside the factory carries its own route, and both its mounts ran.
  assert.equal(endpointFor(result, "GET", "/health").source_location, "main.py:27");
  assert.equal(endpointFor(result, "GET", "/legacy/ping").confidence, 0.9);
});

test("an app assigned through module.exports keeps both its routes and its mounts", () => {
  const result = scanDirectory({ dir: fixture("mount-express-exported-app") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.unresolvedMounts, []);
  // `var app = module.exports = express()`. The name nearest the `=` is `exports`, a
  // property of `module` that no later statement can call the app by, so the chain has to
  // be walked back to `app`. Stopping at `exports` leaves the file with no receiver: the
  // app's own `/health` disappears and `/api/users` reports unmounted.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/users", source_location: "routes/users.js:5", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "app.js:13", confidence: 0.9 },
  ]);
  assert.equal(result.endpoints.some((endpoint) => endpoint.path_template === "/users"), false);
});

test("a router parameter's routes are reported short and flagged, never at full confidence", () => {
  const result = scanDirectory({ dir: fixture("mount-express-app-parameter") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 1);
  // `module.exports = (app) => { app.use('/users', r); ... }`. The parameter is a real
  // receiver, so the routes are found — but whoever calls the function decides what sits
  // in front of `/users`, and that call is in a file nothing here ties back to this one.
  // The prefix is unknown rather than absent, which is why 0.5 is the whole point: at 0.9
  // this reads as a settled path when a segment in front of it was never read.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/users/me", source_location: "routes.js:11", confidence: 0.5 },
  ]);
  assert.equal(endpointFor(result, "GET", "/users/me").confidence, 0.5);

  assert.deepEqual(result.unresolvedMounts, [
    {
      path: "routes.js",
      target: "app",
      reason: "Mount prefix is not a literal, so these routes are reported without it.",
    },
  ]);
});

test("a TypeScript router exported by declaration resolves through a NodeNext specifier", () => {
  const result = scanDirectory({ dir: fixture("mount-express-typescript") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.unresolvedMounts, []);
  // Two things have to hold at once. `export const usersRouter = Router()` declares and
  // exports in one statement, and `import { usersRouter } from './routes/users.js'` names
  // a `.js` file that does not exist — under NodeNext that spelling is mandatory, and this
  // repo's own source is written the same way, so the specifier has to reach `users.ts`.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/users", source_location: "routes/users.ts:7", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "app.ts:13", confidence: 0.9 },
  ]);
  assert.equal(
    result.endpoints.some((endpoint) => endpoint.path_template === "/users"),
    false,
    "an unresolved NodeNext specifier would leave the router mounted nowhere",
  );
});

test("a barrel re-export is followed to the file that declares the router", () => {
  const result = scanDirectory({ dir: fixture("mount-express-barrel") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 3);
  assert.deepEqual(result.unresolvedMounts, []);
  // `routes/index.js` declares no router and names express nowhere; it binds
  // `require('./users')` and passes it on. The mount names the barrel, so resolution has
  // to take the extra hop to `routes/users.js` — stopping at the barrel strands the mount
  // and `/users` is then reported without the `/api` it was mounted under.
  //
  // Written as the single statement `module.exports = require('./users')` this barrel is
  // NOT followed today: the require binds no name, so nothing records the import and the
  // mount comes back in `unresolvedMounts`. That shape is deliberately not asserted here
  // — it is an open defect, not a behaviour to pin.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/users", source_location: "routes/users.js:5", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "app.js:11", confidence: 0.9 },
  ]);
  assert.equal(
    result.endpoints.some((endpoint) => endpoint.source_location.startsWith("routes/index.js")),
    false,
    "the barrel contributes the link, not an endpoint",
  );
});

test("a package aggregator router is followed through __init__.py to its modules", () => {
  const result = scanDirectory({ dir: fixture("mount-fastapi-aggregator") });

  assert.deepEqual(result.frameworks, ["fastapi"]);
  assert.equal(result.fileCount, 3);
  assert.deepEqual(result.unresolvedMounts, []);
  // `from .routers import api_router` names the package's own module, so resolution has to
  // reach `routers/__init__.py`, and the router it names is itself an aggregate: the
  // include inside that file is a second hop to `routers/users.py`. Stopping at either end
  // reports `/users` without the `/api/v1` the app mounted it under.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/v1/users", source_location: "routers/users.py:6", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "main.py:14", confidence: 0.9 },
  ]);
  assert.equal(
    result.endpoints.some((endpoint) => endpoint.source_location.startsWith("routers/__init__.py")),
    false,
    "the aggregator contributes the link, not an endpoint",
  );
});

test("a table-driven mount reads each row's prefix and chains it under the table's own mount", () => {
  const result = scanDirectory({ dir: fixture("mount-express-route-table") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 4);
  assert.deepEqual(result.unresolvedMounts, []);
  // The shape a great many Express projects are laid out in: an array of
  // `{ path, route }` rows and one `defaultRoutes.forEach((route) => router.use(...))`
  // that names no prefix of its own. Every prefix here lives in the table, and each
  // endpoint carries three pieces — `/v1` from `src/app.js`, the row's path, and the path
  // beside the handler. Without the table read, `user.route.js` reports at the bare root.
  assert.deepEqual(result.endpoints, [
    { method: "POST", path_template: "/v1/auth/login", source_location: "src/routes/v1/auth.route.js:7", confidence: 0.9 },
    { method: "POST", path_template: "/v1/auth/register", source_location: "src/routes/v1/auth.route.js:5", confidence: 0.9 },
    { method: "GET", path_template: "/v1/users", source_location: "src/routes/v1/user.route.js:5", confidence: 0.9 },
    { method: "GET", path_template: "/v1/users/{userId}", source_location: "src/routes/v1/user.route.js:7", confidence: 0.9 },
  ]);
  assert.deepEqual([...new Set(result.endpoints.map((endpoint) => endpoint.confidence))], [0.9]);
  // `router.get('/')` under a row path of `/users` is `/v1/users`, not `/v1/users/`.
  assert.equal(result.endpoints.some((endpoint) => endpoint.path_template.endsWith("/")), false);
});

test("a mount table is read under any key names, and by a for-of loop as well as forEach", () => {
  const result = scanDirectory({ dir: fixture("mount-express-route-table-variants") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 5);
  assert.deepEqual(result.unresolvedMounts, []);
  // `routes/keyed.js` writes the table as `{ prefix, router }` and walks it with forEach;
  // `routes/looped.js` writes `{ path, route }` and walks it with `for (const entry of
  // routes)`. Both key names are taken from the `.use()` call rather than assumed, and
  // both loop spellings are the same mount, so the two read identically.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/keyed/billing/plans", source_location: "routes/billing.js:5", confidence: 0.9 },
    { method: "GET", path_template: "/looped/invoices/open", source_location: "routes/invoices.js:5", confidence: 0.9 },
  ]);
  assert.deepEqual([...new Set(result.endpoints.map((endpoint) => endpoint.confidence))], [0.9]);
});

test("one unreadable table row is flagged without costing its siblings their prefixes", () => {
  const result = scanDirectory({ dir: fixture("mount-express-route-table-dynamic") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.equal(result.fileCount, 4);
  // One row states `path: process.env.ADMIN_PATH`, which this scan cannot value. The
  // uncertainty belongs to that row alone: `/api/auth/login` keeps the literal prefix its
  // own row stated, at 0.9, while the admin routes report without theirs at 0.5. Failing
  // the whole table over one row would throw away a prefix that was written down and read.
  assert.deepEqual(result.endpoints, [
    { method: "POST", path_template: "/api/auth/login", source_location: "routes/auth.js:5", confidence: 0.9 },
    { method: "GET", path_template: "/api/settings", source_location: "routes/admin.js:5", confidence: 0.5 },
  ]);
  assert.equal(endpointFor(result, "POST", "/api/auth/login").confidence, 0.9);
  assert.equal(endpointFor(result, "GET", "/api/settings").confidence, 0.5);

  assert.deepEqual(result.unresolvedMounts, [
    {
      path: "routes/index.js",
      target: "adminRoute",
      reason: "Mount prefix is not a literal, so these routes are reported without it.",
    },
  ]);
  // No prefix is guessed at from the unread expression.
  assert.equal(JSON.stringify(result.endpoints).includes("ADMIN_PATH"), false);
});

test("routes declared in test files are never reported, by directory name or by file name", () => {
  const result = scanDirectory({ dir: fixture("express-test-files") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.deepEqual(result.unresolvedMounts, []);
  // Two test files, caught two different ways. `test/app.test.js` is under an ignored
  // directory; `routes/users.spec.js` sits beside the code it covers, where no directory
  // name can catch it — and that is the more common of the two. Each mounts the router at
  // a path of its own invention and declares a route of its own, so a scan that reads
  // either publishes endpoints the deployed server has nothing at.
  assert.deepEqual(result.endpoints, [
    { method: "GET", path_template: "/api/users", source_location: "routes/users.js:5", confidence: 0.9 },
    { method: "GET", path_template: "/health", source_location: "app.js:11", confidence: 0.9 },
  ]);
  assert.equal(result.fileCount, 2, "neither test file may even be read");

  const json = JSON.stringify(result);
  assert.equal(json.includes("spec-only"), false);
  assert.equal(json.includes("test-only"), false);
  assert.equal(json.includes("test-mount"), false);
  assert.equal(json.includes(".spec.js"), false);
  assert.equal(json.includes(".test.js"), false);
  // The router really is mounted bare in both test files, so a bare `/users` reaching the
  // output is the exact failure this pins.
  assert.equal(result.endpoints.some((endpoint) => endpoint.path_template === "/users"), false);
});

test("every mount tree scans byte-identically twice, in sorted order", () => {
  for (const name of MOUNT_FIXTURES) {
    const first = scanDirectory({ dir: fixture(name) });
    const second = scanDirectory({ dir: fixture(name) });
    assert.deepEqual(first, second, `${name} scanned differently the second time`);
    assert.equal(JSON.stringify(first), JSON.stringify(second), `${name} is not byte-identical across scans`);
    // Mount resolution walks maps and sets, so both lists have to come out in a fixed
    // order, not merely with the same members.
    assert.deepEqual(sortEndpoints(first.endpoints), first.endpoints, `${name} endpoints are out of order`);
    assert.deepEqual(first.unresolvedMounts, second.unresolvedMounts, `${name} reordered its unresolved mounts`);
  }
});

test("every tree reports exactly the unresolved mounts it holds and no others", () => {
  for (const name of SCANNABLE_FIXTURES) {
    const result = scanDirectory({ dir: fixture(name) });
    assert.equal(Array.isArray(result.unresolvedMounts), true, `${name} must always report an unresolvedMounts array`);
    assert.equal(
      result.unresolvedMounts.length,
      UNRESOLVED_MOUNT_COUNTS[name] ?? 0,
      `${name} reported an unexpected number of unresolved mounts`,
    );
    for (const mount of result.unresolvedMounts) {
      assert.deepEqual(
        Object.keys(mount).sort(),
        ["path", "reason", "target"],
        `${name} unresolved mount carries an unexpected field`,
      );
      assert.equal(mount.reason.length > 0, true, `${name} reported an unresolved mount with no reason`);
    }
  }
});

test("normalizePathTemplate rewrites each framework's parameter syntax to {name}", () => {
  assert.equal(normalizePathTemplate("/items/{item_id:int}"), "/items/{item_id}");
  assert.equal(normalizePathTemplate("/items/{item_id}"), "/items/{item_id}");
  assert.equal(normalizePathTemplate("/things/<int:pk>"), "/things/{pk}");
  assert.equal(normalizePathTemplate("/things/<pk>"), "/things/{pk}");
  assert.equal(normalizePathTemplate("/users/:id"), "/users/{id}");
  assert.equal(normalizePathTemplate("/blog/[slug]"), "/blog/{slug}");
  assert.equal(normalizePathTemplate("/docs/[...rest]"), "/docs/{rest}");

  // An optional parameter mid-path: the `?` belongs to the parameter, not a query string.
  assert.equal(normalizePathTemplate("/mid/:a?/tail"), "/mid/{a}/tail");
  // An Express regex constraint is a matching rule, not part of the template.
  assert.equal(normalizePathTemplate("/users/:id(\\d+)"), "/users/{id}");
  // Two parameters in one segment: every `:name` is rewritten, not just the first.
  assert.equal(normalizePathTemplate("/a/:b-:c"), "/a/{b}-{c}");
});

test("normalizePathTemplate collapses concrete ids and strips the query string", () => {
  assert.equal(normalizePathTemplate("/users/42"), "/users/{id}");
  assert.equal(
    normalizePathTemplate("/users/3fa85f64-5717-4562-b3fc-2c963f66afa6"),
    "/users/{id}",
  );
  assert.equal(normalizePathTemplate("/search?q=refund&limit=10"), "/search");
  assert.equal(normalizePathTemplate("/users/42?expand=orders"), "/users/{id}");
  assert.equal(normalizePathTemplate("/users/v2"), "/users/v2");
  assert.equal(normalizePathTemplate("/mid/:a?/tail?q=1"), "/mid/{a}/tail");
});

test("spec and source merge field-wise without either side discarding the other", () => {
  const result = scanDirectory({ dir: fixture("fastapi-app") });

  const getUser = endpointFor(result, "GET", "/users/{user_id}");
  assert.equal(getUser.source_location, "main.py:18");
  assert.equal(getUser.confidence, 1);
  assert.deepEqual(getUser.tags, ["users"]);
  assert.deepEqual(Object.keys(getUser).sort(), ["confidence", "method", "path_template", "source_location", "tags"]);

  const postUsers = endpointFor(result, "POST", "/users");
  assert.equal(postUsers.source_location, "main.py:23");
  assert.equal(postUsers.confidence, 1);
  assert.deepEqual(postUsers.tags, ["users"]);
  // The spec states a requestBody for this operation, so the merge carries it onto the
  // source-derived route: the source keeps its location, the spec adds its schema.
  assert.deepEqual(postUsers.request_body_schema, importedBodySchema("fastapi-app", "POST", "/users"));
  assert.deepEqual(
    Object.keys(postUsers).sort(),
    ["confidence", "method", "path_template", "request_body_schema", "source_location", "tags"],
  );
  // The spec states no query parameter schema, and `fromOpenApi` emits none regardless.
  assert.equal("query_schema" in postUsers, false);

  const specOnly = endpointFor(result, "GET", "/reports/summary");
  assert.equal(specOnly.source_location, "openapi.json");
  assert.equal(specOnly.confidence, 1);
  assert.deepEqual(specOnly.tags, ["reports"]);

  const sourceOnly = endpointFor(result, "GET", "/health");
  assert.equal(sourceOnly.source_location, "main.py:13");
  assert.equal(sourceOnly.confidence, 0.9);
  assert.equal("tags" in sourceOnly, false);
});

test("every tree that yields zero endpoints throws PremanConfigError explaining why", () => {
  const noRoutes = scanFailure("fastapi-no-routes");
  assert.match(noRoutes.message, /found no endpoints/);
  assert.match(noRoutes.message, /Matched but produced no routes: fastapi\./);
  assert.match(noRoutes.message, /No spec file was parsed\./);
  assert.match(noRoutes.message, /Read 1 file\./);

  const notASpec = scanFailure("spec-not-openapi");
  assert.match(notASpec.message, /found no endpoints/);
  assert.match(notASpec.message, /No adapter matched\. Tried: fastapi, express\./);
  assert.match(notASpec.message, /Specs found but not used: openapi\.json/);
  assert.match(notASpec.message, /must include a paths object/);

  const yamlOnly = scanFailure("spec-yaml-only");
  assert.match(yamlOnly.message, /found no endpoints/);
  assert.match(yamlOnly.message, /Specs found but not used: openapi\.yaml/);
  assert.match(yamlOnly.message, /YAML specs are not read/);
  assert.match(yamlOnly.message, /preman import openapi --file/);

  const jsxNoRoutes = scanFailure("express-no-routes");
  assert.match(jsxNoRoutes.message, /found no endpoints/);
  assert.match(jsxNoRoutes.message, /Matched but produced no routes: express\./);
  assert.match(jsxNoRoutes.message, /Read 1 file\./);
});

test("a YAML spec is reported as unsupported rather than silently used", () => {
  const result = scanDirectory({ dir: fixture("express-yaml-spec") });

  assert.deepEqual(result.frameworks, ["express"]);
  assert.deepEqual(result.specs, [], "specs names files that were read, so the yaml must not appear");
  assert.equal(result.unsupportedSpecs.length, 1);
  assert.equal(result.unsupportedSpecs[0].path, "openapi.yaml");
  assert.match(result.unsupportedSpecs[0].reason, /YAML/);
  assert.match(result.unsupportedSpecs[0].reason, /preman import openapi --file/);

  // `/yaml-only` exists only in the yaml, so its absence proves the yaml was not parsed.
  assert.deepEqual(routes(result), ["GET /ping"]);
  assert.equal(JSON.stringify(result.endpoints).includes("yaml-only"), false);
});

test("a scan cap sets truncated and stops the whole walk, not just one directory", () => {
  // `scan-cap/` is built to tell the two walks apart. Entries are visited in name
  // order: `app.js` (195 bytes) is admitted, `asub/` is queued, then `big.js`
  // (1881 bytes) blows the budget. Ending the whole walk leaves `asub/` unvisited;
  // breaking only the inner loop still shifts `asub/` off the queue and reads
  // `asub/small.js` (124 bytes), which fits in what is left of the budget.
  const wholeWalk = scanDirectory({ dir: fixture("scan-cap"), maxTotalBytes: 400 });
  assert.equal(wholeWalk.truncated, true);
  assert.equal(wholeWalk.fileCount, 1, "a queued directory must not be visited after the cap is hit");
  assert.deepEqual(routes(wholeWalk), ["GET /first"]);
  assert.equal(
    wholeWalk.endpoints.some((endpoint) => endpoint.source_location.startsWith("asub/")),
    false,
    "asub/ was queued before the cap was hit, so only a whole-walk stop keeps it out",
  );

  const wholeWalkUncapped = scanDirectory({ dir: fixture("scan-cap") });
  assert.equal(wholeWalkUncapped.truncated, false);
  assert.equal(wholeWalkUncapped.fileCount, 3);
  assert.deepEqual(routes(wholeWalkUncapped), ["GET /big", "GET /first", "GET /sub"]);

  const byFiles = scanDirectory({ dir: fixture("express-app"), maxFiles: 1 });
  assert.equal(byFiles.truncated, true);
  assert.equal(byFiles.fileCount, 1);
  assert.deepEqual(
    [...new Set(byFiles.endpoints.map((endpoint) => endpoint.source_location.split(":")[0]))],
    ["app.js"],
    "the cap must end the walk, so no file below the first directory is read",
  );
  assert.equal(byFiles.endpoints.some((endpoint) => endpoint.path_template === "/things"), false);

  // 900 bytes fits app.js (630) but not app.js plus lib/format.js (979).
  const byBytes = scanDirectory({ dir: fixture("express-app"), maxTotalBytes: 900 });
  assert.equal(byBytes.truncated, true);
  assert.equal(byBytes.fileCount, 1);
  assert.deepEqual(byBytes.endpoints, byFiles.endpoints);

  const uncapped = scanDirectory({ dir: fixture("express-app") });
  assert.equal(uncapped.truncated, false);
  assert.equal(uncapped.fileCount, 4);
});

test("a spec's request_body_schema is emitted verbatim and matches what `import openapi` produces", () => {
  const secrets = scanDirectory({ dir: fixture("spec-secrets") });
  assert.deepEqual(routes(secrets), ["POST /charges"]);
  assert.deepEqual(secrets.specs, ["openapi.json"]);

  const charge = endpointFor(secrets, "POST", "/charges");
  const imported = importedBodySchema("spec-secrets", "POST", "/charges");
  assert.notEqual(imported, undefined, "the fixture spec must state a requestBody for this test to mean anything");
  assert.deepEqual(charge.request_body_schema, imported, "scan and `import openapi` must agree on one spec");

  // Verbatim means verbatim: `example`, `default`, `enum` and `description` all survive,
  // exactly as `preman import openapi --file` passes them through. A secret committed to
  // a spec is already in the repo; neither command redacts one.
  const json = JSON.stringify(secrets);
  for (const value of SPEC_BODY_VALUES) {
    assert.equal(json.includes(value), true, `scan dropped ${value} from the spec's body schema`);
  }

  // `fromOpenApi` emits no query schema, so scan has none to carry and never invents one.
  assert.equal("query_schema" in charge, false);
  for (const value of SPEC_QUERY_VALUES) {
    assert.equal(json.includes(value), false, `scan invented a query schema carrying ${value}`);
  }

  for (const name of SCANNABLE_FIXTURES) {
    for (const endpoint of scanDirectory({ dir: fixture(name) }).endpoints) {
      assert.deepEqual(
        Object.keys(endpoint).filter((key) => key !== "tags" && key !== "request_body_schema").sort(),
        ["confidence", "method", "path_template", "source_location"],
        `${name} endpoint carries an unexpected field`,
      );
      assert.equal("query_schema" in endpoint, false, `${name} produced a query_schema, which fromOpenApi never emits`);
    }
  }
});

test("scanning the same tree twice produces deep-equal results", () => {
  for (const name of SCANNABLE_FIXTURES) {
    const first = scanDirectory({ dir: fixture(name) });
    const second = scanDirectory({ dir: fixture(name) });
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  }
});

test("sortEndpoints orders by path_template, then method, then source_location", () => {
  const unsorted = [
    { method: "GET", path_template: "/users/{id}", source_location: "b.js:2", confidence: 0.9 },
    { method: "POST", path_template: "/users", source_location: "a.js:1", confidence: 0.9 },
    { method: "GET", path_template: "/users/{id}", source_location: "a.js:9", confidence: 0.9 },
    { method: "DELETE", path_template: "/users/{id}", source_location: "z.js:1", confidence: 0.9 },
    { method: "GET", path_template: "/users", source_location: "a.js:1", confidence: 0.9 },
  ];
  const input = [...unsorted];

  assert.deepEqual(sortEndpoints(input), [
    { method: "GET", path_template: "/users", source_location: "a.js:1", confidence: 0.9 },
    { method: "POST", path_template: "/users", source_location: "a.js:1", confidence: 0.9 },
    { method: "DELETE", path_template: "/users/{id}", source_location: "z.js:1", confidence: 0.9 },
    { method: "GET", path_template: "/users/{id}", source_location: "a.js:9", confidence: 0.9 },
    { method: "GET", path_template: "/users/{id}", source_location: "b.js:2", confidence: 0.9 },
  ]);
  assert.deepEqual(input, unsorted, "sortEndpoints must not mutate its input");

  const scanned = scanDirectory({ dir: fixture("express-app") });
  assert.deepEqual(sortEndpoints(scanned.endpoints), scanned.endpoints);
});

test("main package re-exports scan helpers", () => {
  assert.equal(typeof main.scanDirectory, "function");
  assert.equal(typeof main.normalizePathTemplate, "function");
  assert.equal(typeof main.sortEndpoints, "function");
  assert.equal(typeof main.fastapiAdapter, "object");
  assert.equal(typeof main.expressAdapter, "object");
  assert.equal(main.scanDirectory, scanDirectory);
  assert.equal(main.normalizePathTemplate, normalizePathTemplate);
  assert.equal(main.sortEndpoints, sortEndpoints);
  assert.equal("mergeEndpoints" in main, false);
  assert.equal("mergeEndpointPair" in main, false);
  assert.equal("readSourceTree" in main, false);
  assert.equal("endpointsFromSpec" in main, false);
  assert.equal("sourceLocationFor" in main, false);
  assert.equal("builtInAdapters" in main, false);
  assert.equal("normalizeSegment" in main, false);
  assert.equal("parameterName" in main, false);
  assert.equal("emptyScanMessage" in main, false);
  assert.equal("stripQueryString" in main, false);
  assert.equal("colonParameters" in main, false);
  assert.equal("frameworkParameter" in main, false);
  assert.equal("isConcreteId" in main, false);
  assert.equal("isReadableSource" in main, false);
  // Mount resolution is an implementation detail of `scanDirectory`; none of its
  // helpers is part of the package surface.
  assert.equal("applyMounts" in main, false);
  assert.equal("chainsFor" in main, false);
  assert.equal("cycleMount" in main, false);
  assert.equal("mountedUnits" in main, false);
  assert.equal("unresolvedReason" in main, false);
  assert.equal("resolveSpecifier" in main, false);
  assert.equal("relativeTo" in main, false);
  assert.equal("mountedEndpoint" in main, false);
  assert.equal("joinTemplate" in main, false);
  assert.equal("unitKey" in main, false);
  // Export and specifier resolution is the same implementation detail: a barrel hop, an
  // inline `require()` in a `.use()`, and the `.js`-to-`.ts` rewrite NodeNext forces.
  assert.equal("reExported" in main, false);
  assert.equal("inlineSpecifier" in main, false);
  assert.equal("typescriptSources" in main, false);
});

test("preman scan CLI reports endpoints without PREMAN_API_KEY and exits by outcome", () => {
  const dir = mkdtempSync(join(tmpdir(), "preman-scan-"));

  const runCli = (args) => spawnSync(process.execPath, ["dist/cli.js", "scan", ...args], {
    cwd: process.cwd(),
    env: {},
    encoding: "utf8",
  });

  const json = runCli(["--dir", "test/fixtures/fastapi-app", "--json"]);
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.dir, "test/fixtures/fastapi-app");
  assert.deepEqual(parsed.frameworks, ["fastapi"]);
  assert.deepEqual(parsed.specs, ["openapi.json"]);
  assert.deepEqual(parsed.unsupportedSpecs, []);
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.fileCount, 7);
  assert.deepEqual(parsed.endpoints, FASTAPI_ENDPOINTS);
  assert.equal("error" in parsed, false);
  // The spec states a requestBody for POST /users, so `scan --json` prints it.
  assert.equal(json.stdout.includes("request_body_schema"), true);
  assert.equal(json.stdout.includes("query_schema"), false);

  const text = runCli(["--dir", "test/fixtures/express-app"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Frameworks: express/);
  assert.match(text.stdout, /Total endpoints: 12/);
  assert.equal(text.stdout.includes("not-a-route"), false);
  assert.equal(text.stdout.includes("partial result"), false);

  const yamlSpec = runCli(["--dir", "test/fixtures/express-yaml-spec"]);
  assert.equal(yamlSpec.status, 0, yamlSpec.stderr);
  assert.match(yamlSpec.stdout, /Spec not used: openapi\.yaml/);
  assert.match(yamlSpec.stdout, /YAML specs are not read/);
  assert.equal(yamlSpec.stdout.includes("Specs: openapi.yaml"), false);
  assert.equal(yamlSpec.stdout.includes("yaml-only"), false);

  const bait = runCli(["--dir", "test/fixtures/spec-secrets", "--json"]);
  assert.equal(bait.status, 0, bait.stderr);
  const parsedBait = JSON.parse(bait.stdout);
  assert.deepEqual(parsedBait.endpoints.map((endpoint) => endpoint.path_template), ["/charges"]);
  assert.deepEqual(
    parsedBait.endpoints[0].request_body_schema,
    importedBodySchema("spec-secrets", "POST", "/charges"),
    "the CLI prints the spec's schema exactly as `import openapi` emits it",
  );

  const unsupported = runCli(["--dir", "test/fixtures/unknown-app", "--json"]);
  assert.equal(unsupported.status, 2);
  const parsedUnsupported = JSON.parse(unsupported.stdout);
  assert.deepEqual(parsedUnsupported.endpoints, []);
  assert.equal(parsedUnsupported.error.code, "invalid_config");
  assert.match(parsedUnsupported.error.message, /Tried: fastapi, express/);

  const noEndpoints = runCli(["--dir", "test/fixtures/fastapi-no-routes", "--json"]);
  assert.equal(noEndpoints.status, 2);
  const parsedNoEndpoints = JSON.parse(noEndpoints.stdout);
  assert.deepEqual(parsedNoEndpoints.endpoints, []);
  assert.equal(parsedNoEndpoints.error.code, "invalid_config");
  assert.match(parsedNoEndpoints.error.message, /Matched but produced no routes: fastapi/);

  const belowFloor = runCli(["--dir", "test/fixtures/express-app", "--min-endpoints", "50", "--json"]);
  assert.equal(belowFloor.status, 1);
  assert.equal(JSON.parse(belowFloor.stdout).endpoints.length, 12);
  assert.match(belowFloor.stderr, /min_endpoints_not_met/);

  const metFloor = runCli(["--dir", "test/fixtures/express-app", "--min-endpoints", "12", "--json"]);
  assert.equal(metFloor.status, 0, metFloor.stderr);

  const missingDir = runCli(["--dir", join(dir, "does-not-exist"), "--json"]);
  assert.equal(missingDir.status, 2);
  assert.equal(JSON.parse(missingDir.stdout).error.code, "invalid_config");

  const emptyDir = runCli(["--dir", dir, "--json"]);
  assert.equal(emptyDir.status, 2);
  assert.equal(JSON.parse(emptyDir.stdout).error.code, "invalid_config");

  const allOutput = [
    json, text, yamlSpec, bait, unsupported, noEndpoints, belowFloor, metFloor, missingDir, emptyDir,
  ].map((run) => `${run.stdout}${run.stderr}`).join("");
  // `--json` prints the spec's body schema unchanged, and nothing from a query parameter.
  for (const value of SPEC_BODY_VALUES) {
    assert.equal(allOutput.includes(value), true, `CLI dropped ${value} from the spec's body schema`);
  }
  for (const value of SPEC_QUERY_VALUES) {
    assert.equal(allOutput.includes(value), false, `CLI printed ${value} from a query parameter`);
  }
  // The scan is offline, so no run may mention a key it never needed.
  assert.equal(allOutput.includes("PREMAN_API_KEY"), false);
  assert.equal(allOutput.includes("Missing API key"), false);
  assert.equal(allOutput.includes("Authorization"), false);
});
