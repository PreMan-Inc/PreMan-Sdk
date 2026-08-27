import type {
  DiscoveredEndpoint,
  FileRoutes,
  FrameworkAdapter,
  LocalRoute,
  MountEdge,
  SourceFile,
} from "./scan.js";
import { normalizePathTemplate } from "./scan.js";
import type { HttpMethod } from "./types.js";

/** Confidence for a route stated by an explicit decorator, which names its own method and path. */
const ROUTE_CONFIDENCE = 0.9;

const PYTHON_EXTENSION = ".py";

const EXTENSIONS: readonly string[] = [PYTHON_EXTENSION];

/**
 * Matches only up to the opening quote. The scan runs over masked text, where
 * every literal is blanked, so the path itself is read back from the original.
 */
const DECORATOR_PATTERN = /@(\w+)\.(get|post|put|patch|delete|head|options)\s*\(\s*(['"])/gi;

const API_ROUTE_PATTERN = /@(\w+)\.api_route\s*\(\s*(['"])/gi;

const METHODS_PATTERN = /methods\s*=\s*\[/i;

const METHOD_NAME_PATTERN = /['"](\w+)['"]/g;

/**
 * `app = FastAPI()`, `router = APIRouter()`, `app: FastAPI = FastAPI()`.
 *
 * Every gap is horizontal whitespace rather than `\s`, because an assignment and its
 * annotation live on one line and `\s` matches a newline. Crossing one let the return
 * annotation of `def create_app() -> FastAPI:` swallow the line below it: the receiver
 * captured was `FastAPI`, never `app`, so FastAPI's own application-factory idiom
 * yielded no routes and no mounts at all. The same shape read `if settings.enabled:`
 * as a receiver named `enabled`. The annotation is bounded like `MODULE_BINDING_PATTERN`
 * bounds its own, so a line with no `=` on it costs a fixed scan rather than the rest
 * of the file — unbounded, one long line made the whole pattern quadratic.
 */
const RECEIVER_PATTERN = /\b(\w+)[^\S\n]*(?::[^=\n]{0,200})?=[^\S\n]*(FastAPI|APIRouter)[^\S\n]*\(/g;

/** The constructor that can carry a prefix: an application takes no `prefix=`. */
const ROUTER_CONSTRUCTOR = "APIRouter";

/** `app.include_router(...)`: the only call that mounts a router under another. */
const INCLUDE_ROUTER_PATTERN = /\b(\w+)\s*\.\s*include_router\s*\(/g;

/** A `prefix=` keyword argument, anchored so only the argument's own head is read. */
const PREFIX_ARGUMENT_PATTERN = /^\s*prefix\s*=\s*/;

/** `from .routers.users import router as users_router`. Bounded to one module path. */
const FROM_IMPORT_PATTERN = /^[ \t]*from[ \t]+([.\w]{1,200})[ \t]+import[ \t]*/gm;

/** `import app.routers.users as users`. Bounded: the clause never leaves its line. */
const PLAIN_IMPORT_PATTERN = /^[ \t]*import[ \t]+(?=[.\w])/gm;

/** One entry of an import clause: `users`, `users as u`, `app.routers.users as u`. */
const IMPORT_ENTRY_PATTERN = /^([.\w]+)(?:[ \t]+as[ \t]+(\w+))?$/;

/**
 * A binding assigned at column zero. Python exposes every module-level name, so
 * the `m` anchor is what separates an importable router from one built inside a
 * function, which no other file can reach by name.
 */
const MODULE_BINDING_PATTERN = /^(\w+)[ \t]*(?::[^=\n]{0,200})?=(?!=)/gm;

/**
 * A whole argument that is one name, optionally with attributes read off it:
 * `include_router(users_router)` names no binding, `include_router(users.router)` names
 * `router` on `users`. Bounded to eight attributes, which no real mount reaches.
 */
const MOUNT_TARGET_PATTERN = /^\s*([A-Za-z_]\w*)((?:\s*\.\s*[A-Za-z_]\w*){0,8})\s*$/;

/** Whitespace inside a dotted target, so `users . router` reports as `users` + `router`. */
const SPACE_PATTERN = /\s+/g;

const QUOTE_PATTERN = /['"]/;

const IMPORT_PATTERN = /(from\s+fastapi\b|import\s+fastapi\b)/;

const HTTP_METHODS = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/**
 * Longest argument list a single call may span before the scan gives up on it. Raised
 * from 400 because an idiomatic `APIRouter(prefix=..., tags=[...], responses={...})`
 * runs past that routinely, and the prefix is the first thing lost when it does. It
 * stays a constant: the cost of one call is fixed, so a file of unbalanced `APIRouter(`
 * costs a fixed scan per call rather than growing with what follows it.
 */
const MAX_CALL_SPAN = 2_000;

/**
 * Suffix naming the unit that holds the contents of a router whose own prefix could not
 * be read. `#` opens a comment in Python and can never occur in a binding, so this
 * cannot collide with a name the source uses.
 */
const UNREADABLE_PREFIX_UNIT = "#prefix";

/** Half-open bounds of one argument inside the masked text. */
type Slice = {
  start: number;
  end: number;
};

/** A binding assigned from FastAPI, and the prefix its own construction stated. */
type Receiver = {
  /** Literal prefix declared on the router. Empty when it declared none. */
  prefix: string;
  /** True when a prefix is stated in a form this scanner cannot read. */
  unreadable?: boolean;
};

/** What one file imports, under the local names it uses for it. */
type ImportedNames = {
  /** Local binding to the module specifier it came from. */
  modules: Record<string, string>;
  /**
   * Local binding to the name its own module knows it by, from `from X import a as b`.
   * A binding bound to a whole module has none: it names no single thing inside one.
   */
  sources: Map<string, string>;
};

/** FastAPI route decorators, including APIRouter prefixes declared in the same file. */
export const fastapiAdapter: FrameworkAdapter = {
  name: "fastapi",
  extensions: EXTENSIONS,
  matches: (files) => files.some((file) => isSource(file.path) && IMPORT_PATTERN.test(file.text)),
  extract: (file) => extractFastapiFile(file),
};

function isSource(path: string): boolean {
  return EXTENSIONS.some((extension) => path.endsWith(extension));
}

/**
 * Every fact one file states: the routes it declares, and the links that let an
 * `include_router` in another file reach them. Nothing is resolved here — a
 * binding is reported under the name this file uses for it, and `scan.ts` joins
 * the names up across files, so one resolver serves every framework.
 */
function extractFastapiFile(file: SourceFile): FileRoutes {
  if (!IMPORT_PATTERN.test(file.text)) {
    return { routes: [], exported: [], imports: {}, mounts: [] };
  }
  const code = maskNonCode(file.text);
  const receivers = routeReceivers(code, file.text);
  const imports = importedBindings(code);
  if (receivers.size === 0) {
    return { routes: [], exported: [], imports: imports.modules, mounts: [] };
  }
  const routes = localRoutes(file, code, receivers);
  const mounts = mountEdges(file.text, code, receivers, imports);
  return {
    routes,
    exported: exportedBindings(code, receivers),
    imports: imports.modules,
    // Self-mounts last, so a mount the source states is reported before one inferred
    // from it and `unresolvedMounts` keeps reading in source order.
    mounts: [...mounts, ...unreadablePrefixMounts(receivers, routes, mounts)],
  };
}

/**
 * Blanks comments and literal contents, keeping every offset and newline, so a
 * decorator in a comment or inside a docstring is not code and cannot be
 * discovered. Quote characters survive, so the masked text still shows where a
 * literal is.
 */
function maskNonCode(text: string): string {
  const out = text.split("");
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "#") {
      const end = endOfLine(text, index);
      blankRange(out, text, index, end);
      index = end;
      continue;
    }
    if (char === "'" || char === '"') {
      index = maskLiteral(out, text, index);
      continue;
    }
    index += 1;
  }
  return out.join("");
}

/**
 * A `"""` docstring runs to its closing fence; a single-quoted string ends at its
 * quote or at the newline, so an unterminated one costs a line, not the file.
 */
function maskLiteral(out: string[], text: string, start: number): number {
  const quote = text.charAt(start);
  const fence = quote.repeat(3);
  const triple = text.startsWith(fence, start);
  const width = triple ? 3 : 1;
  let index = start + width;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "\\") {
      blankRange(out, text, index, index + 2);
      index += 2;
      continue;
    }
    if (triple ? text.startsWith(fence, index) : char === quote) {
      return index + width;
    }
    if (!triple && char === "\n") return index;
    blankRange(out, text, index, index + 1);
    index += 1;
  }
  return index;
}

function blankRange(out: string[], text: string, start: number, end: number): void {
  for (let index = start; index < end && index < text.length; index += 1) {
    if (text.charAt(index) !== "\n") out[index] = " ";
  }
}

function endOfLine(text: string, start: number): number {
  const newline = text.indexOf("\n", start);
  return newline < 0 ? text.length : newline;
}

/**
 * Only a name assigned from FastAPI itself carries routes. The value is the
 * prefix: `router = APIRouter(prefix="/api/v1")` stated in the same file is safe
 * to apply, and an app or a bare router simply has none.
 *
 * A prefix that is stated but unreadable is neither of those, and is kept apart from
 * both: reading it as absent puts every route on that router at a path the server does
 * not answer on, at full confidence and with nothing anywhere saying so.
 */
function routeReceivers(code: string, text: string): Map<string, Receiver> {
  const receivers = new Map<string, Receiver>();
  for (const match of code.matchAll(RECEIVER_PATTERN)) {
    const [whole, name, constructed] = match;
    if (!whole || !name || !constructed) continue;
    const open = (match.index ?? 0) + whole.length - 1;
    const call = closingParen(code, open);
    if (call === undefined) {
      // The argument list outran the span bound, so whether it states a prefix is
      // unknown — and unknown is not none. Only a router can carry one, so an
      // application whose long `FastAPI(title=..., description=...)` outran the bound
      // has lost nothing and stays certain.
      receivers.set(name, constructed === ROUTER_CONSTRUCTOR ? { prefix: "", unreadable: true } : { prefix: "" });
      continue;
    }
    receivers.set(name, declaredPrefix(text, code, open, call));
  }
  return receivers;
}

/**
 * The prefix one construction states. Only the call's own top-level arguments are read,
 * so a `prefix=` nested inside a dependency or a response model is never mistaken for
 * the router's own.
 */
function declaredPrefix(text: string, code: string, open: number, call: number): Receiver {
  for (const argument of callArguments(code, open, call)) {
    const declared = PREFIX_ARGUMENT_PATTERN.exec(code.slice(argument.start, argument.end));
    if (!declared) continue;
    const literal = literalArgument(text, code, argument.start + declared[0].length, argument.end);
    return literal === undefined ? { prefix: "", unreadable: true } : { prefix: literal };
  }
  return { prefix: "" };
}

/**
 * The unit holding a receiver's contents. A router whose own prefix could not be read
 * holds them one step below itself, so every route beneath it — its own and every router
 * it includes — reaches the outside world through the edge carrying that uncertainty,
 * whatever prefixes are applied above.
 */
function contentUnit(name: string, receiver: Receiver): string {
  return receiver.unreadable ? `${name}${UNREADABLE_PREFIX_UNIT}` : name;
}

/** Bounded so an unbalanced file cannot make the whole scan quadratic. */
function closingParen(code: string, open: number): number | undefined {
  const limit = Math.min(code.length, open + MAX_CALL_SPAN);
  let depth = 0;
  for (let index = open; index < limit; index += 1) {
    const char = code.charAt(index);
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return undefined;
}

/**
 * The literal an argument states, when the argument is that literal and nothing else.
 * `prefix="/api/" + VERSION` opens with a quote and would otherwise read as `/api/`, a
 * prefix no server serves; a value with anything beside the literal is computed, and
 * computed is unreadable rather than partly known.
 */
function literalArgument(text: string, code: string, lead: number, end: number): string | undefined {
  if (!QUOTE_PATTERN.test(code.charAt(lead))) return undefined;
  const literal = literalAt(text, code, lead);
  if (literal === undefined) return undefined;
  // The literal is two quotes wider than the value it holds, so what sits between its
  // closing quote and the end of the argument is what says whether anything else is
  // stated. A close past the argument's own end is a literal that never terminated.
  const close = lead + literal.length + 2;
  return close <= end && code.slice(close, end).trim() === "" ? literal : undefined;
}

/** Reads the literal from the original text at an offset the masked text located. */
function literalAt(text: string, code: string, quoteIndex: number): string | undefined {
  const quote = code.charAt(quoteIndex);
  const start = quoteIndex + 1;
  const offset = code.slice(start, start + MAX_CALL_SPAN).indexOf(quote);
  if (offset < 0) return undefined;
  const raw = text.slice(start, start + offset);
  return raw.includes("\n") ? undefined : raw;
}

/**
 * Every local binding this file imports, under the module it came from. Which of
 * them are routers cannot be known from one file, so all of them are reported and
 * the resolver decides.
 */
function importedBindings(code: string): ImportedNames {
  const modules: Record<string, string> = {};
  const sources = new Map<string, string>();

  for (const match of code.matchAll(FROM_IMPORT_PATTERN)) {
    const [whole, module] = match;
    if (!whole || !module) continue;
    const specifier = moduleSpecifier(module);
    for (const entry of importClause(code, (match.index ?? 0) + whole.length)) {
      const source = entry[1];
      const name = entry[2] ?? source;
      if (!name || !source) continue;
      modules[name] = specifier;
      // `from .routers.multi import router_a` names one router in that module. Keeping
      // the name it has there is what lets a bare mount of it narrow to that router,
      // instead of prefixing every router the module happens to declare.
      if (!source.includes(".")) sources.set(name, source);
    }
  }

  for (const match of code.matchAll(PLAIN_IMPORT_PATTERN)) {
    const whole = match[0];
    if (!whole) continue;
    for (const entry of importClause(code, (match.index ?? 0) + whole.length)) {
      // `import a.b.c` binds `a`, the head of the path, not the module it names. The
      // binding is a whole module, naming nothing inside one, so it states no source
      // name for a mount to narrow by.
      const name = entry[2] ?? entry[1]?.split(".")[0];
      if (name && entry[1]) modules[name] = moduleSpecifier(entry[1]);
    }
  }

  return { modules, sources };
}

/**
 * The entries of one import clause, parenthesized or not. Bounded either way, so a
 * missing bracket costs one clause's worth of scanning rather than the file.
 */
function importClause(code: string, start: number): RegExpExecArray[] {
  const parenthesized = code.charAt(start) === "(";
  const close = parenthesized ? closingParen(code, start) : undefined;
  if (parenthesized && close === undefined) return [];
  const limit = Math.min(code.length, start + MAX_CALL_SPAN);
  const list = parenthesized && close !== undefined
    ? code.slice(start + 1, close - 1)
    : code.slice(start, Math.min(endOfLine(code, start), limit));
  const entries: RegExpExecArray[] = [];
  for (const entry of list.split(",")) {
    const parsed = IMPORT_ENTRY_PATTERN.exec(entry.trim());
    if (parsed) entries.push(parsed);
  }
  return entries;
}

/**
 * A Python module path, stated as the extensionless specifier `scan.ts` resolves:
 * `.routers.users` is `./routers/users`. The extension is left off deliberately —
 * `from .routers import users` is ambiguous, naming either a module `.routers` holding
 * the name `users` or a package `.routers` holding the module `users`, and only the
 * file tree can say which. The resolver tries both shapes and every extension, so
 * stating one here would decide the question wrongly half the time. An absolute module
 * names no path relative to this file — without a package root there is nothing to
 * resolve it against — so it is reported exactly as written and the resolver declines it.
 */
function moduleSpecifier(module: string): string {
  const dots = module.length - module.replace(/^\.+/, "").length;
  if (dots === 0) return module;
  const tail = module.slice(dots);
  const up = dots === 1 ? "./" : "../".repeat(dots - 1);
  return tail ? `${up}${tail.split(".").join("/")}` : up;
}

/** Every route declared here, each under the receiver it was declared on. */
function localRoutes(file: SourceFile, code: string, receivers: ReadonlyMap<string, Receiver>): LocalRoute[] {
  const lines = lineOffsets(file.text);
  const routes: LocalRoute[] = [];

  for (const match of code.matchAll(DECORATOR_PATTERN)) {
    const [whole, target, method] = match;
    const index = match.index ?? 0;
    if (!whole || !target || !method) continue;
    const receiver = receivers.get(target);
    if (receiver === undefined) continue;
    const named = httpMethod(method);
    const path = literalAt(file.text, code, index + whole.length - 1);
    if (!named || path === undefined) continue;
    routes.push({
      endpoint: routeFor(file, lines, index, named, joinPath(receiver.prefix, path)),
      owner: contentUnit(target, receiver),
    });
  }

  for (const match of code.matchAll(API_ROUTE_PATTERN)) {
    const [whole, target] = match;
    const index = match.index ?? 0;
    if (!whole || !target) continue;
    const receiver = receivers.get(target);
    if (receiver === undefined) continue;
    const path = literalAt(file.text, code, index + whole.length - 1);
    if (path === undefined) continue;
    const open = code.indexOf("(", index);
    const call = open < 0 ? undefined : closingParen(code, open);
    if (call === undefined) continue;
    for (const method of declaredMethods(file.text, code, open, call)) {
      routes.push({
        endpoint: routeFor(file, lines, index, method, joinPath(receiver.prefix, path)),
        owner: contentUnit(target, receiver),
      });
    }
  }

  return routes;
}

/** `methods=["BREW", "GET"]` states one method FastAPI has and one it does not. */
function declaredMethods(text: string, code: string, open: number, call: number): HttpMethod[] {
  const declared = METHODS_PATTERN.exec(code.slice(open, call));
  if (!declared) return [];
  const list = open + declared.index + declared[0].length;
  const end = code.indexOf("]", list);
  if (end < 0 || end > call) return [];
  return [...text.slice(list, end).matchAll(METHOD_NAME_PATTERN)]
    .flatMap((entry) => {
      const method = entry[1] ? httpMethod(entry[1]) : undefined;
      return method ? [method] : [];
    });
}

function routeFor(
  file: SourceFile,
  lines: readonly number[],
  index: number,
  method: HttpMethod,
  path: string,
): DiscoveredEndpoint {
  return {
    method,
    path_template: normalizePathTemplate(path),
    source_location: `${file.path}:${lineAt(lines, index)}`,
    confidence: ROUTE_CONFIDENCE,
  };
}

function joinPath(prefix: string | undefined, path: string): string {
  if (!prefix) return path;
  return `${prefix.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function httpMethod(value: string): HttpMethod | undefined {
  const method = value.toUpperCase() as HttpMethod;
  return HTTP_METHODS.has(method) ? method : undefined;
}

/**
 * Bindings this file hands to its neighbours. Python has no export statement: a
 * module-level `router = APIRouter()` is already importable by name, so every
 * router bound at module level is exposed and the resolver picks the one a mount
 * actually names. Only a router declared here can be mounted as one, so the rest
 * of the module's names are dropped.
 */
function exportedBindings(code: string, receivers: ReadonlyMap<string, Receiver>): string[] {
  const names: string[] = [];
  for (const match of code.matchAll(MODULE_BINDING_PATTERN)) {
    const name = match[1];
    if (name) names.push(name);
  }
  return [...new Set(names)].filter((name) => receivers.has(name));
}

/**
 * The `host.include_router(router, prefix=...)` edges stated here, reported and
 * never resolved. A target may be a bare name or a dotted one — `users.router`, the
 * layout FastAPI's own docs teach — and either form names the single router to mount
 * whenever the source says which one it is, so a module exposing several does not have
 * them all prefixed. A prefix that is not a readable literal is flagged rather than
 * guessed: a wrong prefix is a wrong endpoint, while a missing one is only a
 * route that stays where it was declared. No `prefix=` at all is neither — that
 * is a mount at the host's own root, which is a fact and not an uncertainty.
 */
function mountEdges(
  text: string,
  code: string,
  receivers: ReadonlyMap<string, Receiver>,
  imports: ImportedNames,
): MountEdge[] {
  const mounts: MountEdge[] = [];

  for (const match of code.matchAll(INCLUDE_ROUTER_PATTERN)) {
    const [whole, host] = match;
    const index = match.index ?? 0;
    if (!whole || !host) continue;
    const receiver = receivers.get(host);
    if (receiver === undefined) continue;
    const open = index + whole.length - 1;
    const call = closingParen(code, open);
    if (call === undefined) continue;
    const args = callArguments(code, open, call);
    const first = args[0];
    if (!first) continue;
    const parsed = MOUNT_TARGET_PATTERN.exec(code.slice(first.start, first.end));
    const target = parsed?.[1];
    if (!target) continue;
    const attributes = (parsed?.[2] ?? "").replace(SPACE_PATTERN, "");
    // A dotted target names the router it wants outright. A bare one names it too when
    // it was imported by name: `from .routers.multi import router_a` mounts `router_a`
    // and nothing else, so taking every router that module declares prefixes routers
    // this mount never touched and reports paths the server does not serve.
    const targetBinding = attributes ? attributes.slice(1) : imports.sources.get(target);
    // A dotted target is a mount only when its head is a name this file actually has:
    // a binding it imported, or a router it declared. Anything else is an attribute
    // expression nothing here can follow, and reporting it would invent a link.
    if (
      attributes !== ""
      && imports.modules[target] === undefined
      && !receivers.has(target)
    ) continue;

    let prefix: string | undefined;
    let unreadablePrefix: boolean | undefined;
    for (const argument of args.slice(1)) {
      const declared = PREFIX_ARGUMENT_PATTERN.exec(code.slice(argument.start, argument.end));
      if (!declared) continue;
      const literal = literalArgument(text, code, argument.start + declared[0].length, argument.end);
      prefix = literal === undefined ? undefined : normalizePathTemplate(literal);
      unreadablePrefix = prefix === undefined ? true : undefined;
      break;
    }

    mounts.push(omitUndefined({
      target,
      targetBinding,
      host: contentUnit(host, receiver),
      prefix,
      unreadablePrefix,
    }));
  }

  return mounts;
}

/**
 * The self-mounts carrying a router's own unreadable prefix. `APIRouter(prefix=CONST)`
 * states a prefix exactly as `include_router(..., prefix=CONST)` does, and puts the
 * routes under it just as far from where they were written, so it is reported through
 * the same channel: the router's contents mount on the router itself under a prefix
 * nobody could read. That lowers the confidence of every route beneath it and lists the
 * mount as unresolved, while leaving the router itself free to be mounted from another
 * file — a prefix applied there still chains above this one.
 *
 * An edge is stated only for a router that actually holds something, so no flag is
 * raised over a router with nothing under it to misplace.
 */
function unreadablePrefixMounts(
  receivers: ReadonlyMap<string, Receiver>,
  routes: readonly LocalRoute[],
  mounts: readonly MountEdge[],
): MountEdge[] {
  // Read once rather than searched per receiver: a file declaring many routers, each
  // with a prefix nobody can read, must not cost a pass over its routes for every one.
  const holders = new Set<string>();
  for (const route of routes) holders.add(route.owner);
  for (const mount of mounts) {
    if (mount.host !== undefined) holders.add(mount.host);
  }

  const edges: MountEdge[] = [];
  for (const [name, receiver] of receivers) {
    if (!receiver.unreadable) continue;
    const unit = contentUnit(name, receiver);
    if (holders.has(unit)) edges.push(omitUndefined({ target: unit, host: name, unreadablePrefix: true }));
  }
  return edges;
}

/** Top-level arguments of one call, so a nested call or collection never splits one. */
function callArguments(code: string, open: number, call: number): Slice[] {
  const slices: Slice[] = [];
  let depth = 0;
  let start = open + 1;
  for (let index = open; index < call; index += 1) {
    const char = code.charAt(index);
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth > 0) continue;
      if (index > start) slices.push({ start, end: index });
      break;
    }
    if (char === "," && depth === 1) {
      slices.push({ start, end: index });
      start = index + 1;
    }
  }
  return slices;
}

/** Every newline offset, read once: a file with many routes must not cost a scan per route. */
function lineOffsets(text: string): number[] {
  const offsets: number[] = [];
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) {
    offsets.push(index);
  }
  return offsets;
}

function lineAt(offsets: readonly number[], index: number): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const offset = offsets[middle];
    if (offset === undefined || offset >= index) high = middle;
    else low = middle + 1;
  }
  return low + 1;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
