import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { expressAdapter } from "./scan-express.js";
import { fastapiAdapter } from "./scan-fastapi.js";
import { fromOpenApi } from "./importers.js";
import { PremanConfigError } from "./errors.js";
import type { EndpointDefinition, HttpMethod, JsonSchema } from "./types.js";

/**
 * One route found in a checkout. Field names are the shape
 * `register_discovered_endpoints` accepts, so scan output feeds the hosted API
 * with no translation.
 *
 * Schemas from a committed spec are carried through verbatim, matching what
 * `preman import openapi --file X` already emits for the same document — neither
 * path redacts, so a scan and an import of one spec agree field for field. The
 * `specs` list names every file that was read, so a spec discovered under `--dir`
 * is never used without being reported.
 */
export type DiscoveredEndpoint = {
  method: HttpMethod;
  path_template: string;
  source_location: string;
  confidence: number;
  tags?: string[];
  request_body_schema?: JsonSchema;
  query_schema?: JsonSchema;
};

/** A source file handed to an adapter. Adapters never touch the filesystem themselves. */
export type SourceFile = {
  path: string;
  text: string;
};

/**
 * A framework's route reader. Adapters are pure functions of file content so each
 * one is independently testable and the whole scan stays offline and deterministic.
 */
export type FrameworkAdapter = {
  name: string;
  extensions: readonly string[];
  matches: (files: readonly SourceFile[]) => boolean;
  extract: (file: SourceFile) => FileRoutes;
};

/**
 * Everything one file contributes. Routes alone are not enough: a router is
 * commonly declared in one file and mounted under a prefix in another, so an
 * adapter also reports how this file links to its neighbours. Resolving those
 * links is this module's job, not the adapter's, so every framework gets it once.
 */
export type FileRoutes = {
  routes: readonly LocalRoute[];
  /** Bindings this file exposes to other files, from `module.exports = router`. */
  exported: readonly string[];
  /** Local binding to the specifier it was imported from, e.g. `router` -> `./routes/users`. */
  imports: Readonly<Record<string, string>>;
  /** Prefix mounts declared here, from `app.use(prefix, router)`. */
  mounts: readonly MountEdge[];
};

/**
 * A route and the binding it was declared on. A file may declare several routers
 * and export only one, so a mount has to know which routes it applies to.
 * The owner is empty when the route hangs off the application itself.
 */
export type LocalRoute = {
  endpoint: DiscoveredEndpoint;
  owner: string;
};

/** One `app.use(prefix, router)` edge. */
export type MountEdge = {
  /** Binding being mounted, resolved against `imports` or the file's own routers. */
  target: string;
  /**
   * Attribute read off the target, for `include_router(users.router)`. Names the one
   * router to mount, so a module exposing several does not have them all prefixed.
   */
  targetBinding?: string;
  /** Binding `.use()` was called on. Absent means the application itself. */
  host?: string;
  /** Normalized prefix. Absent when the prefix is not a literal this scanner can read. */
  prefix?: string;
  /**
   * True when a prefix is applied but could not be read, as in `app.use(base, r)`.
   * The mounted routes are reported without it rather than under a guessed path.
   */
  unreadablePrefix?: boolean;
};

/**
 * A spec file that was found but contributed nothing, with the reason. Keeping these
 * out of `specs` is the point: `specs` names files that were actually read, so it can
 * never imply a spec was used when it was not.
 */
export type UnsupportedSpec = {
  path: string;
  reason: string;
};

/**
 * A mount that was found but could not be followed. Reported rather than guessed:
 * the routes still appear, at the path they were written with, so a caller can see
 * that a prefix exists somewhere and that this scan could not read it.
 */
export type UnresolvedMount = {
  /** File declaring the mount. */
  path: string;
  /** Binding being mounted. */
  target: string;
  reason: string;
};

export type ScanResult = {
  dir: string;
  frameworks: string[];
  endpoints: DiscoveredEndpoint[];
  unresolvedMounts: UnresolvedMount[];
  /** Spec files that parsed. A file listed here was read and its routes are included. */
  specs: string[];
  unsupportedSpecs: UnsupportedSpec[];
  fileCount: number;
  /** True when a cap stopped the walk early, so the result describes part of the tree. */
  truncated: boolean;
};

export type ScanOptions = {
  dir?: string;
  adapters?: readonly FrameworkAdapter[];
  ignore?: readonly string[];
  maxFiles?: number;
  maxTotalBytes?: number;
};

type ReadTree = {
  files: SourceFile[];
  truncated: boolean;
  oversized: UnsupportedSpec[];
};

type SpecParse = {
  value: DiscoveredEndpoint[];
  error?: string;
};

type ParsedSpec = {
  path: string;
  count: number;
};

type LinkedRoutes = {
  endpoints: DiscoveredEndpoint[];
  unresolved: UnresolvedMount[];
};

/** One mount edge, pointing back at the router that hosts it. */
type MountLink = {
  host: string;
  prefix?: string;
  unreadablePrefix?: boolean;
};

/** An accumulated prefix path from a root router down to one that carries routes. */
type MountChain = {
  prefix: string;
  unreadablePrefix?: boolean;
  /** True when the only way here ran through a mount loop, so no prefix is defensible. */
  looped?: boolean;
};

type EmptyScanFacts = {
  dir: string;
  adapters: readonly FrameworkAdapter[];
  matched: readonly FrameworkAdapter[];
  parsed: readonly ParsedSpec[];
  unsupported: readonly UnsupportedSpec[];
  tree: ReadTree;
};

/**
 * Directories holding no routes the application serves. Test trees are excluded for
 * the same reason as `node_modules`: a test mounts a router to exercise it, not to
 * expose it, so `app.use("/", router)` under supertest describes the test's own
 * throwaway app rather than anything the deployed server answers on.
 */
const DEFAULT_IGNORED_DIRS: readonly string[] = [
  ".git",
  "node_modules",
  "test",
  "tests",
  "__tests__",
  "spec",
  "e2e",
  "cypress",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
];

/**
 * Test files sitting beside the code they cover, which directory names never catch:
 * `users.test.ts` next to `users.ts`, and pytest's `test_users.py` / `users_test.py`.
 */
const TEST_FILE_PATTERN =
  /(^|[/\\])(test_[^/\\]+\.py|[^/\\]+(_test\.py|\.(test|spec)\.[cm]?[jt]sx?))$/i;

const SPEC_FILE_PATTERN = /(^|[/\\])(openapi|swagger)[^/\\]*\.(json|ya?ml)$/i;

/**
 * One `:name` parameter, with an optional Express regex constraint and modifier.
 * Global so a segment holding several (`/a/:b-:c`) rewrites every one.
 */
const COLON_PARAMETER_PATTERN = /:([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?[?*+]?/g;

const SOURCE_EXTENSIONS: readonly string[] = [".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"];

const DEFAULT_MAX_FILES = 5_000;

const MAX_FILE_BYTES = 1_000_000;

/**
 * Aggregate budget across the whole walk. `MAX_FILE_BYTES` alone is not a bound:
 * thousands of legally-sized files still hold every byte in memory at once.
 */
const DEFAULT_MAX_TOTAL_BYTES = 32_000_000;

/** Confidence for a route read from a committed spec, which states its own contract. */
const SPEC_CONFIDENCE = 1;

/** Confidence for routes under a prefix that exists but could not be read. */
const MOUNT_UNREADABLE_CONFIDENCE = 0.5;

/** Extensions tried when resolving a relative import. Node's order, then Python. */
const MODULE_EXTENSIONS: readonly string[] = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py"];

const YAML_SPEC_REASON =
  "YAML specs are not read: the SDK has no runtime dependencies and ships no YAML parser. "
  + "Convert it to JSON, or import it with `preman import openapi --file`.";

/**
 * Read a checkout and report the routes it exposes. Deterministic and offline:
 * no network, no model call, and the same tree always produces the same result.
 *
 * Throws rather than returning an empty endpoint list: a silent `[]` reads as
 * "no endpoints here" when the truth is "nothing here could be read".
 */
export function scanDirectory(options: ScanOptions = {}): ScanResult {
  const dir = options.dir ?? process.cwd();
  const adapters = options.adapters ?? builtInAdapters();
  const tree = readSourceTree(dir, options);

  const matched = adapters.filter((adapter) => adapter.matches(tree.files));
  const specFiles = tree.files.filter((file) => SPEC_FILE_PATTERN.test(file.path));

  if (matched.length === 0 && specFiles.length === 0) {
    const skipped = tree.oversized.length
      ? ` ${tree.oversized.length} file(s) were skipped for exceeding the ${MAX_FILE_BYTES}-byte scan cap: `
        + `${tree.oversized.map((file) => file.path).join(", ")}.`
      : "";
    throw new PremanConfigError(
      `No adapter matched ${dir}. Tried: ${adapters.map((adapter) => adapter.name).join(", ")}. `
      + `No committed OpenAPI or Swagger spec was found either.${skipped}`,
    );
  }

  const facts = new Map<string, FileRoutes>();
  for (const adapter of matched) {
    for (const file of tree.files) {
      if (!adapter.extensions.some((extension) => file.path.endsWith(extension))) continue;
      facts.set(file.path, adapter.extract(file));
    }
  }

  const linked = applyMounts(facts);
  const found: DiscoveredEndpoint[] = [];
  // Appended one at a time: `push(...endpoints)` passes every endpoint as an
  // argument, which throws RangeError once a single file yields enough of them.
  for (const endpoint of linked.endpoints) {
    found.push(endpoint);
  }

  const parsed: ParsedSpec[] = [];
  const unsupported: UnsupportedSpec[] = [...tree.oversized];
  for (const spec of specFiles) {
    const result = endpointsFromSpec(spec);
    if (result.error !== undefined) {
      unsupported.push({ path: spec.path, reason: result.error });
      continue;
    }
    parsed.push({ path: spec.path, count: result.value.length });
    for (const endpoint of result.value) {
      found.push(endpoint);
    }
  }

  const endpoints = mergeEndpoints(found);
  if (endpoints.length === 0) {
    throw new PremanConfigError(emptyScanMessage({ dir, adapters, matched, parsed, unsupported, tree }));
  }

  return {
    dir,
    frameworks: matched.map((adapter) => adapter.name),
    endpoints,
    unresolvedMounts: linked.unresolved,
    specs: parsed.map((spec) => spec.path),
    unsupportedSpecs: unsupported,
    fileCount: tree.files.length,
    truncated: tree.truncated,
  };
}

/**
 * Normalize a route to a path template: concrete ids collapse to `{id}`, and each
 * framework's own parameter syntax becomes `{name}`, so two routes differing only
 * by a real id are one route.
 */
export function normalizePathTemplate(path: string): string {
  const withoutQuery = stripQueryString(path);
  const segments = withoutQuery.split("/").filter((segment) => segment.length > 0);
  const normalized = segments.map((segment) => normalizeSegment(segment));
  return `/${normalized.join("/")}`;
}

/** Deterministic order so two scans of one tree are byte-identical. */
export function sortEndpoints(endpoints: readonly DiscoveredEndpoint[]): DiscoveredEndpoint[] {
  return [...endpoints].sort((left, right) => {
    if (left.path_template !== right.path_template) {
      return left.path_template < right.path_template ? -1 : 1;
    }
    if (left.method !== right.method) {
      return left.method < right.method ? -1 : 1;
    }
    return left.source_location < right.source_location ? -1 : 1;
  });
}

/**
 * Join routes to the prefixes they are mounted under. A router is routinely declared
 * in one file and mounted in another, and a mounted router may itself mount others, so
 * the path written beside a handler is not the path the server answers on.
 *
 * Only observed links are followed. A prefix is attached to a route that was already
 * found, so this can relocate an endpoint but never invent one, and a router nobody
 * mounts still reports its routes exactly as written. Anything that cannot be followed
 * is returned as an `UnresolvedMount` rather than guessed at.
 */
function applyMounts(facts: ReadonlyMap<string, FileRoutes>): LinkedRoutes {
  const incoming = new Map<string, MountLink[]>();
  const unresolved: UnresolvedMount[] = [];

  for (const [path, file] of facts) {
    for (const mount of file.mounts) {
      const targets = mountedUnits(path, file, mount, facts);
      if (targets.length === 0) {
        unresolved.push({ path, target: mount.target, reason: unresolvedReason(file, mount) });
        continue;
      }
      if (mount.unreadablePrefix) {
        unresolved.push({
          path,
          target: mount.target,
          reason: "Mount prefix is not a literal, so these routes are reported without it.",
        });
      }
      for (const target of targets) {
        const link = omitUndefined({
          host: unitKey(path, mount.host ?? ""),
          prefix: mount.prefix,
          unreadablePrefix: mount.unreadablePrefix,
        });
        const existing = incoming.get(target);
        if (existing) {
          existing.push(link);
          continue;
        }
        incoming.set(target, [link]);
      }
    }
  }

  const chains = new Map<string, MountChain[]>();
  const cycles = new Set<string>();
  const endpoints: DiscoveredEndpoint[] = [];
  for (const [path, file] of facts) {
    for (const route of file.routes) {
      // One endpoint per chain: a router mounted twice genuinely answers on both paths.
      const unit = unitKey(path, route.owner);
      for (const chain of chainsFor(unit, incoming, chains, new Set(), cycles)) {
        endpoints.push(mountedEndpoint(route.endpoint, chain));
      }
    }
  }
  for (const cycle of cycles) {
    unresolved.push(cycleMount(cycle));
  }

  return { endpoints, unresolved };
}

/**
 * Every prefix chain that reaches a router, walking mounts back to a router nobody
 * mounts. Memoised per unit; `visiting` breaks a cycle by refusing to re-enter a unit
 * already on the current path, so `a` mounting `b` mounting `a` terminates.
 */
function chainsFor(
  unit: string,
  incoming: ReadonlyMap<string, MountLink[]>,
  memo: Map<string, MountChain[]>,
  visiting: Set<string>,
  cycles: Set<string>,
): MountChain[] {
  const cached = memo.get(unit);
  if (cached) return cached;

  const links = incoming.get(unit);
  if (!links || links.length === 0) return [{ prefix: "" }];

  visiting.add(unit);
  const chains: MountChain[] = [];
  let looped = false;
  for (const link of links) {
    // Re-entering a router already on this path is a mount loop. Record which edge
    // closed it and stop, rather than recursing or reporting the result as settled.
    if (visiting.has(link.host)) {
      cycles.add(`${link.host}\u0001${unit}`);
      looped = true;
      continue;
    }
    for (const parent of chainsFor(link.host, incoming, memo, visiting, cycles)) {
      chains.push(omitUndefined({
        prefix: `${parent.prefix}${link.prefix ?? ""}`,
        // Uncertainty travels down the chain: one unreadable prefix anywhere above,
        // or one loop broken anywhere above, means every path below it is suspect.
        unreadablePrefix: parent.unreadablePrefix || link.unreadablePrefix || undefined,
        looped: parent.looped || undefined,
      }));
    }
  }
  visiting.delete(unit);

  // Reachable only through a loop: every prefix on offer came from an arbitrary break
  // in that loop, so none is defensible and the routes report at the path they were
  // written with.
  const resolved = chains.length > 0 ? chains : [{ prefix: "", looped: true }];
  // Only cache a result computed without a loop: inside one it depends on the path
  // taken to get here, so it is not a property of the unit.
  if (!looped) memo.set(unit, resolved);
  return resolved;
}

/** Turns a recorded loop edge back into a reportable mount. */
function cycleMount(cycle: string): UnresolvedMount {
  const [host = "", target = ""] = cycle.split("\u0001");
  const [path = ""] = host.split("\u0000");
  const [, owner = ""] = target.split("\u0000");
  return {
    path,
    target: owner,
    reason: "Mount loops back to a router that already mounts this one. Every prefix on "
      + "offer comes from an arbitrary break in that loop, so routes reachable only "
      + "through it are reported at the path they were written with.",
  };
}

/** The router units a mount points at: an imported file's exports, or a local router. */
function mountedUnits(
  path: string,
  file: FileRoutes,
  mount: MountEdge,
  facts: ReadonlyMap<string, FileRoutes>,
): string[] {
  const specifier = file.imports[mount.target] ?? inlineSpecifier(mount.target);
  if (specifier !== undefined) {
    // Every file the specifier could name, in resolution order. The first that actually
    // exports what is being mounted wins: `from .routers import users` may mean a module
    // `routers` holding the name, or a package `routers` holding the module, and only the
    // exports settle which. Preferring the first path that merely exists picks wrong
    // whenever both shapes are present.
    for (const target of resolveSpecifier(path, specifier, mount.target, facts)) {
      const targetFile = facts.get(target);
      if (targetFile === undefined) continue;
      // A dotted mount names the router it wants; a bare one takes whatever the file
      // exposes, since there is nothing to narrow it by.
      const exported = mount.targetBinding === undefined
        ? targetFile.exported
        : targetFile.exported.filter((binding) => binding === mount.targetBinding);
      if (exported.length > 0) {
        return exported.flatMap((binding) => reExported(target, targetFile, binding, facts, new Set()));
      }
    }
    return [];
  }
  return file.routes.some((route) => route.owner === mount.target)
    || file.mounts.some((other) => other.host === mount.target)
    ? [unitKey(path, mount.target)]
    : [];
}

/**
 * Follows a re-export to the file that declares the router. A barrel
 * (`routes/index.js` doing `module.exports = require("./users")`) exposes a binding it
 * imported rather than one it declared, so the router is one hop further on. Bounded by
 * `seen`, since barrels can point at each other.
 */
function reExported(
  path: string,
  file: FileRoutes,
  binding: string,
  facts: ReadonlyMap<string, FileRoutes>,
  seen: Set<string>,
): string[] {
  const unit = unitKey(path, binding);
  if (seen.has(unit)) return [];
  // Declared here: this is the router itself, not a pass-through.
  if (file.routes.some((route) => route.owner === binding)) return [unit];
  // A binding that is itself a `require("./x")` call names its module directly, which is
  // how a barrel re-exports without ever binding what it passes along.
  const specifier = file.imports[binding] ?? inlineSpecifier(binding);
  if (specifier === undefined) return [unit];

  seen.add(unit);
  for (const target of resolveSpecifier(path, specifier, binding, facts)) {
    const targetFile = facts.get(target);
    if (targetFile === undefined || targetFile.exported.length === 0) continue;
    const hops = targetFile.exported.flatMap((name) => reExported(target, targetFile, name, facts, seen));
    if (hops.length > 0) return hops;
  }
  // Nothing further resolved, so the binding stands on its own.
  return [unit];
}

/**
 * The module named by a mount written inline, as in `app.use("/api", require("./routes"))`.
 * There is no binding to look such a target up by, but the specifier is stated in the
 * call itself, so the mount is followable without one.
 */
function inlineSpecifier(target: string): string | undefined {
  const inline = /^(?:require|import)\s*\(\s*(['"`])(\.[^'"`]{0,200})\1\s*\)$/.exec(target);
  return inline?.[2];
}

function unresolvedReason(file: FileRoutes, mount: MountEdge): string {
  const specifier = file.imports[mount.target] ?? inlineSpecifier(mount.target);
  return specifier === undefined
    ? `No router named ${mount.target} was declared in this file or imported into it.`
    : `Mounted from ${specifier}, which did not resolve to a scanned file exporting a router.`;
}

/**
 * Resolves a relative specifier against the files actually scanned.
 *
 * `from .routers import users` is ambiguous in Python: `.routers` may be a module
 * holding a name `users`, or a package holding a module `users`. The syntax is the
 * same either way, so both shapes are tried and the file tree decides. The module
 * shape is tried first, matching how Python itself resolves the name.
 */
function resolveSpecifier(
  from: string,
  specifier: string,
  binding: string,
  facts: ReadonlyMap<string, FileRoutes>,
): string[] {
  if (!specifier.startsWith(".")) return [];
  const base = relativeTo(from, specifier);
  if (base === undefined) return [];
  const bases = binding && !binding.includes(".") ? [base, `${base}/${binding}`] : [base];
  const candidates = bases.flatMap((candidate) => [
    candidate,
    ...MODULE_EXTENSIONS.map((extension) => `${candidate}${extension}`),
    ...MODULE_EXTENSIONS.map((extension) => `${candidate}/index${extension}`),
    // Python's equivalent of an index file: `from .routers import x` may name the
    // package's own module, which is where an aggregate router is usually built.
    `${candidate}/__init__.py`,
    ...typescriptSources(candidate),
    ...typescriptSources(`${candidate}/index.js`),
  ]);
  return candidates.filter((candidate) => facts.has(candidate));
}

/**
 * The TypeScript source behind a compiled specifier. Under NodeNext an import must be
 * written `./users.js` even though the file on disk is `./users.ts`, so a specifier
 * naming a JavaScript file routinely has no JavaScript file to find.
 */
function typescriptSources(candidate: string): string[] {
  const compiled = /\.(?:js|mjs|cjs)$/.exec(candidate);
  if (!compiled) return [];
  const stem = candidate.slice(0, -compiled[0].length);
  return [`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`];
}

/** Resolves `./x` and `../x` against a file path. Paths are always forward-slashed here. */
function relativeTo(from: string, specifier: string): string | undefined {
  const segments = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") {
      segments.push(part);
      continue;
    }
    if (segments.length === 0) return undefined;
    segments.pop();
  }
  return segments.join("/");
}

function mountedEndpoint(endpoint: DiscoveredEndpoint, chain: MountChain): DiscoveredEndpoint {
  // A prefix we could see but not read, or one reachable only through a loop, means the
  // written path is probably short. The route is still reported, at the only path we can
  // defend, with confidence lowered to say so.
  const confidence = chain.unreadablePrefix || chain.looped
    ? Math.min(endpoint.confidence, MOUNT_UNREADABLE_CONFIDENCE)
    : endpoint.confidence;
  return {
    ...endpoint,
    confidence,
    path_template: joinTemplate(chain.prefix, endpoint.path_template),
  };
}

function joinTemplate(prefix: string, path: string): string {
  const head = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return `${head}${path === "/" ? "" : path}` || "/";
}

/** A router is identified by the file that declares it plus the binding it is bound to. */
function unitKey(path: string, owner: string): string {
  return `${path}\u0000${owner}`;
}

function readSourceTree(dir: string, options: ScanOptions): ReadTree {
  let root: string;
  try {
    root = statSync(dir).isDirectory() ? dir : "";
  } catch {
    throw new PremanConfigError(`Scan directory ${dir} could not be read.`);
  }
  if (!root) {
    throw new PremanConfigError(`Scan path ${dir} is not a directory.`);
  }

  const ignored = new Set([...DEFAULT_IGNORED_DIRS, ...(options.ignore ?? [])]);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const files: SourceFile[] = [];
  const oversized: UnsupportedSpec[] = [];
  const queue: string[] = [root];
  let totalBytes = 0;
  let truncated = false;

  // `truncated` ends the whole walk, not just the current directory: breaking out of
  // the inner loop alone still reads every directory left in the queue.
  while (queue.length > 0 && !truncated) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const entry of sortedEntries(current)) {
      if (ignored.has(entry.name) || entry.name.startsWith(".") && entry.isDirectory()) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const path = relative(root, full).split(sep).join("/");
      if (!isReadableSource(path)) continue;
      const bytes = fileSize(full);
      if (bytes === undefined) continue;
      // A file too large to read is reported rather than dropped: silently skipping it
      // would let the result claim to be complete while a real spec sat unread.
      if (bytes > MAX_FILE_BYTES) {
        oversized.push({
          path,
          reason: `File is ${bytes} bytes, larger than the ${MAX_FILE_BYTES}-byte scan cap, so it was not read.`,
        });
        continue;
      }
      if (files.length >= maxFiles || totalBytes + bytes > maxTotalBytes) {
        truncated = true;
        break;
      }
      const text = readTextFile(full);
      if (text !== undefined) {
        totalBytes += bytes;
        files.push({ path, text });
      }
    }
  }

  return { files, truncated, oversized };
}

function sortedEntries(dir: string): { name: string; isDirectory: () => boolean; isFile: () => boolean }[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .sort((left, right) => (left.name < right.name ? -1 : 1));
  } catch {
    return [];
  }
}

function isReadableSource(path: string): boolean {
  if (SPEC_FILE_PATTERN.test(path)) return true;
  if (TEST_FILE_PATTERN.test(path)) return false;
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/** Size is read before the file is, so the byte budget is never blown by the read itself. */
function fileSize(full: string): number | undefined {
  try {
    return statSync(full).size;
  } catch {
    return undefined;
  }
}

function readTextFile(full: string): string | undefined {
  try {
    return readFileSync(full, "utf8");
  } catch {
    return undefined;
  }
}

/** Returns the reason on failure instead of swallowing it, so the caller can say why. */
function endpointsFromSpec(spec: SourceFile): SpecParse {
  if (!spec.path.toLowerCase().endsWith(".json")) {
    return { value: [], error: YAML_SPEC_REASON };
  }
  let parsed: EndpointDefinition[];
  try {
    parsed = fromOpenApi(spec.text);
  } catch (error) {
    return {
      value: [],
      error: error instanceof Error ? error.message : "The spec could not be parsed.",
    };
  }
  return {
    value: parsed.flatMap((endpoint) => {
      const path = endpoint.path_template ?? endpoint.pathTemplate ?? endpoint.path;
      if (!path) return [];
      return [omitUndefined({
        method: endpoint.method,
        path_template: normalizePathTemplate(path),
        source_location: spec.path,
        confidence: SPEC_CONFIDENCE,
        tags: endpoint.tags,
        request_body_schema: endpoint.request_body_schema ?? endpoint.requestBodySchema,
        query_schema: endpoint.query_schema ?? endpoint.querySchema,
      })];
    }),
  };
}

/** Names every reason the scan came up empty, so the failure is actionable without a rerun. */
function emptyScanMessage(facts: EmptyScanFacts): string {
  const parts = [`Scanned ${facts.dir} and found no endpoints.`];

  parts.push(facts.matched.length > 0
    ? `Matched but produced no routes: ${facts.matched.map((adapter) => adapter.name).join(", ")}.`
    : `No adapter matched. Tried: ${facts.adapters.map((adapter) => adapter.name).join(", ")}.`);

  parts.push(facts.parsed.length > 0
    ? `Specs parsed with no usable operation: ${facts.parsed.map((spec) => `${spec.path} (${spec.count})`).join(", ")}.`
    : "No spec file was parsed.");

  if (facts.unsupported.length > 0) {
    parts.push(`Specs found but not used: ${facts.unsupported.map((spec) => `${spec.path} — ${spec.reason}`).join(" ")}`);
  }

  const read = `${facts.tree.files.length} ${facts.tree.files.length === 1 ? "file" : "files"}`;
  parts.push(facts.tree.truncated
    ? `Read ${read} before hitting a scan cap, so the tree was only partly read.`
    : `Read ${read}.`);

  return parts.join(" ");
}

/**
 * Collapse duplicates field-wise. A spec that states a field wins; a spec that is
 * silent yields to the source-derived value, so neither side discards the other.
 */
function mergeEndpoints(endpoints: readonly DiscoveredEndpoint[]): DiscoveredEndpoint[] {
  const byRoute = new Map<string, DiscoveredEndpoint>();
  for (const endpoint of endpoints) {
    const key = `${endpoint.method} ${endpoint.path_template}`;
    const existing = byRoute.get(key);
    byRoute.set(key, existing ? mergeEndpointPair(existing, endpoint) : endpoint);
  }
  return sortEndpoints([...byRoute.values()]);
}

function mergeEndpointPair(left: DiscoveredEndpoint, right: DiscoveredEndpoint): DiscoveredEndpoint {
  const [stronger, weaker] = right.confidence > left.confidence ? [right, left] : [left, right];
  return omitUndefined({
    method: stronger.method,
    path_template: stronger.path_template,
    source_location: sourceLocationFor(stronger, weaker),
    confidence: stronger.confidence,
    tags: stronger.tags ?? weaker.tags,
    request_body_schema: stronger.request_body_schema ?? weaker.request_body_schema,
    query_schema: stronger.query_schema ?? weaker.query_schema,
  });
}

/** A spec path is not a handler location, so a real `file:line` always wins. */
function sourceLocationFor(stronger: DiscoveredEndpoint, weaker: DiscoveredEndpoint): string {
  if (stronger.source_location.includes(":")) return stronger.source_location;
  if (weaker.source_location.includes(":")) return weaker.source_location;
  return stronger.source_location;
}

/**
 * Drops a real trailing query string only. A `?` followed by `/` is an optional
 * parameter mid-path (`/mid/:a?/tail`); cutting at the first `?` would throw the
 * rest of the route away.
 */
function stripQueryString(path: string): string {
  for (let index = 0; index < path.length; index += 1) {
    if (path[index] !== "?") continue;
    const next = path[index + 1];
    if (next === undefined || next === "/") continue;
    return path.slice(0, index);
  }
  return path;
}

function normalizeSegment(segment: string): string {
  if (segment.startsWith(":")) return colonParameters(segment);
  const framework = frameworkParameter(segment);
  if (framework) return `{${framework}}`;
  if (isConcreteId(segment)) return "{id}";
  return segment;
}

/**
 * Rewrites every `:name` in one segment, not just the first: Express allows several
 * in a segment (`/a/:b-:c`) and a regex constraint after the name (`/users/:id(\d+)`),
 * which is a matching rule, not part of the template.
 */
function colonParameters(segment: string): string {
  const rewritten = segment.replace(COLON_PARAMETER_PATTERN, (_match, name: string) => `{${name}}`);
  return rewritten.includes("{") ? rewritten : "{id}";
}

function frameworkParameter(segment: string): string | undefined {
  if (segment.startsWith("{") && segment.endsWith("}")) {
    return parameterName(segment.slice(1, -1), "first");
  }
  if (segment.startsWith("[") && segment.endsWith("]")) {
    return parameterName(segment.replace(/^\[+|\]+$/g, "").replace(/^\.\.\./, ""), "first");
  }
  if (segment.startsWith("<") && segment.endsWith(">")) {
    return parameterName(segment.slice(1, -1), "last");
  }
  if (segment === "*") {
    return "wildcard";
  }
  return undefined;
}

/**
 * Strips converters, constraints, and modifiers, keeping the name. Which half of
 * `a:b` is the name depends on the framework: FastAPI and Starlette write
 * `{item_id:int}` with the name first, while Flask and Django write `<int:pk>` with
 * the converter first, so the bracket style decides which side to take.
 */
function parameterName(raw: string, side: "first" | "last"): string {
  const withoutConstraint = raw.replace(/\([\s\S]*$/, "");
  const parts = withoutConstraint.split(":");
  const picked = side === "first" ? parts[0] : parts[parts.length - 1];
  const name = (picked ?? "").replace(/[?*+]/g, "").trim();
  return name || "id";
}

function isConcreteId(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

/**
 * Resolved on call, not at module load. The adapter modules import this one for
 * `normalizePathTemplate`, so a top-level array here is in the temporal dead zone
 * whenever an adapter module is evaluated first.
 */
function builtInAdapters(): readonly FrameworkAdapter[] {
  return [fastapiAdapter, expressAdapter];
}
