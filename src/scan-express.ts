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

/** Confidence for a route stated by an explicit method call naming its own path. */
const ROUTE_CONFIDENCE = 0.9;

const EXTENSIONS: readonly string[] = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"];

/**
 * Matches only up to the opening quote. The scan runs over masked text, where
 * every literal is blanked, so the path itself is read back from the original.
 */
const ROUTE_PATTERN =
  /\b(\w+)\s*\.\s*(get|post|put|patch|delete|head|options|all)\s*\(\s*(['"`])/gi;

const ROUTE_CHAIN_PATTERN = /\b(\w+)\s*\.\s*route\s*\(\s*(['"`])/gi;

/** Anchored: a chain link must start where the previous call ended, not 400 characters later. */
const CHAINED_METHOD_PATTERN =
  /^\s*\.\s*(get|post|put|patch|delete|head|options|all)\s*\(/i;

/**
 * `app = express()`, `router = express.Router()`, `router = Router()`.
 *
 * The annotation of `const router: Router = ...` is bounded like every other run in this
 * file. Unbounded, it costs one scan to the end of the line per `:` in the file, which on
 * a long single-line array literal is the whole file scanned once per property.
 */
const RECEIVER_PATTERN =
  /\b(\w+)\s*(?::\s*[^=;\n]{1,200})?=\s*(?:await\s+)?(?:new\s+)?(?:express\s*\.\s*Router|express|Router)\s*\(/g;

/** `app.use(...)`: the only call that mounts a router, and also every middleware call. */
const USE_PATTERN = /\b(\w+)\s*\.\s*use\s*\(/g;

/** `const users = require('./users')`. The binding is captured whole so `{ a, b }` survives. */
const REQUIRE_PATTERN =
  /\b(?:const|let|var)\s+([^=;]{1,200})=\s*(?:await\s+)?require\s*\(\s*(['"])/g;

/** `import users, { a as b } from './users'`. `import type` binds no value, so it is skipped. */
const ESM_IMPORT_PATTERN = /\bimport\s+(?!type\b)([^;'"]{1,200}?)\bfrom\s*(['"])/g;

/** `module.exports = router` and `module.exports = { users: router }`. */
const MODULE_EXPORTS_PATTERN = /\bmodule\s*\.\s*exports\s*=\s*([A-Za-z_$][\w$]*|\{)/g;

const EXPORTS_PROPERTY_PATTERN = /\bexports\s*\.\s*[\w$]+\s*=\s*([A-Za-z_$][\w$]*)/g;

const EXPORT_DEFAULT_PATTERN = /\bexport\s+default\s+([A-Za-z_$][\w$]*)/g;

/** Bounded: an unclosed brace costs one statement's worth of scanning, not the file. */
const EXPORT_LIST_PATTERN = /\bexport\s*\{([^}]{0,400})\}/g;

/** `export const usersRouter = Router()`: a declaration and its export in one statement. */
const EXPORT_DECLARATION_PATTERN = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;

/**
 * `export { usersRouter } from './users'`: a binding passed straight on, never bound
 * locally. Bounded like the export list above, and ending at the opening quote so the
 * specifier is read back from the original text.
 */
const EXPORT_FROM_PATTERN = /\bexport\s*\{([^}]{0,400})\}\s*from\s*(['"])/g;

const IMPORT_PATTERN = /require\(\s*['"]express['"]\s*\)|from\s+['"]express['"]/;

/** A file naming neither express nor any export states nothing this scan can use. */
const EXPORT_HINT_PATTERN = /\bexports?\b/;

const INTERPOLATION_PATTERN = /\$\{([^}]*)\}/g;

/**
 * One `${...}` anywhere. A mount prefix holding one states a value, not a path, so it
 * is unreadable rather than a template; a route path keeps the template reading.
 */
const HAS_INTERPOLATION_PATTERN = /\$\{[^}]*\}/;

const IDENTIFIER_TAIL_PATTERN = /([A-Za-z_$][\w$]*)\s*$/;

/** The head of a binding, so the annotation in `const router: Router = ...` is not read as the name. */
const IDENTIFIER_HEAD_PATTERN = /^\s*([A-Za-z_$][\w$]*)/;

/**
 * A whole argument that is one name, optionally with properties read off it:
 * `app.use(usersRouter)` names no property, `app.use(routes.usersRouter)` names
 * `usersRouter` on `routes`. Bounded to eight, which no real mount reaches.
 * `express.json()` does not match, having a call in it.
 */
const MOUNT_TARGET_PATTERN = /^\s*([A-Za-z_$][\w$]*)((?:\s*\.\s*[A-Za-z_$][\w$]*){0,8})\s*$/;

/** Whitespace inside a dotted target, so `routes . usersRouter` reports as one property. */
const SPACE_PATTERN = /\s+/g;

/** `require('./routes')` written straight into `.use()`, with no binding to follow it by. */
const INLINE_MODULE_PATTERN = /\b(?:require|import)\s*\(/;

/** The same call read whole, so a re-export can be followed by the specifier it states. */
const INLINE_MODULE_CALL_PATTERN = /^(?:require|import)\s*\(\s*(['"`])[^'"`\n]{0,200}\1\s*\)/;

/** Call, arrow, object and array syntax: an argument holding any of it is middleware, not a prefix. */
const NOT_A_PREFIX_PATTERN = /[(){}[\]=]/;

const QUOTE_PATTERN = /['"`]/;

const BRACE_PATTERN = /[{}]/g;

/** `import { type Config }` names a type, not a value binding. */
const TYPE_ENTRY_PATTERN = /^type\s/;

/**
 * `defaultRoutes.forEach(` — the head of a loop that may mount a table of routers. Only
 * the head is matched: the callback and the array it walks are read separately, each
 * under its own bound.
 */
const FOREACH_PATTERN = /\b([A-Za-z_$][\w$]*)\s*\.\s*forEach\s*\(/g;

/** `for (const route of defaultRoutes)`: the same table walked the other way round. */
const FOR_OF_PATTERN =
  /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+([A-Za-z_$][\w$]*)\s*\)/g;

/** The row binding of a loop callback: `(route) =>`, `route =>`, `function (route)`. */
const CALLBACK_PARAMETER_PATTERN =
  /^\s*(?:async\s+)?(?:function\s*(?:[A-Za-z_$][\w$]*)?\s*)?(?:\(\s*([A-Za-z_$][\w$]*)\s*[,)]|([A-Za-z_$][\w$]*)\s*=>)/;

/** `const defaultRoutes = [` — the head of an array literal that may be a mount table. */
const ARRAY_TABLE_PATTERN =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;\n]{0,120})?=\s*\[/g;

/** `path:` at the head of one object-literal entry, so the value begins after it. */
const OBJECT_KEY_PATTERN = /^\s*([A-Za-z_$][\w$]*)\s*:/;

/** A shorthand entry, `{ path, route }`, whose key names its value too. */
const SHORTHAND_KEY_PATTERN = /^\s*([A-Za-z_$][\w$]*)\s*$/;

/** `route.path`: one property read off the loop row, filling the whole argument. */
const PARAMETER_PROPERTY_PATTERN = /^\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*$/;

/**
 * `export default (app) => {` and `module.exports = function (app) {`: a function handed
 * a router by whoever calls it. Only the first parameter is read, which is where every
 * shape of this idiom puts the router.
 */
const EXPORTED_FUNCTION_PATTERN =
  /\b(?:export\s+default|module\s*\.\s*exports\s*=)\s*(?:async\s+)?(?:function\s*(?:[A-Za-z_$][\w$]*)?\s*)?\(\s*([A-Za-z_$][\w$]*)\s*[,):]/g;

/** Single characters, tested one at a time while a walk steps through the masked text. */
const SPACE_CHAR_PATTERN = /\s/;

const IDENTIFIER_CHAR_PATTERN = /[\w$]/;

const NAME_START_PATTERN = /[A-Za-z_$]/;

/** A character that turns a trailing `=` into a comparison or a compound assignment. */
const OPERATOR_CHAR_PATTERN = /[=!<>+\-*\/%&|^~]/;

const ALL_METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const HTTP_METHODS = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/** Longest argument list a single call may span before the scan gives up on it. */
const MAX_CALL_SPAN = 400;

/** Longest `.route()` chain read, so one malformed file cannot stall the scan. */
const MAX_CHAIN_LINKS = 8;

/** Longest loop body read as a table mount, so one long callback cannot stall the scan. */
const MAX_LOOP_SPAN = 2000;

/** Longest array literal read as a mount table. */
const MAX_TABLE_SPAN = 4000;

/** Longest exported function body searched for a router parameter. */
const MAX_FUNCTION_SPAN = 8000;

/** Longest run between a head — a parameter list, a loop clause — and the body it opens. */
const MAX_HEAD_SPAN = 120;

/** Longest chain of `a = b = express()` targets walked back from one receiver match. */
const MAX_ASSIGNMENT_LINKS = 4;

/** Half-open bounds of one argument inside the masked text. */
type Slice = {
  start: number;
  end: number;
};

/** A local binding and the name it carries in the module it came from. */
type ImportedBinding = {
  local: string;
  /** Absent for a whole-module, default or namespace import: none names a single export. */
  imported?: string;
};

/**
 * What one file's imports state. `specifiers` is the map `FileRoutes` carries;
 * `names` stays private here, because narrowing a mount to one export is this
 * language's import syntax being read, which the shared resolver cannot redo.
 */
type ImportFacts = {
  /** Local binding to the specifier it was imported from. */
  specifiers: Record<string, string>;
  /** Local binding to the name it was imported under, for named imports only. */
  names: Record<string, string>;
};

/** What the first argument of a `.use()` call says about where the mount hangs. */
type MountPath = {
  /** One entry per path this mount applies; `undefined` is a mount with no readable prefix. */
  prefixes: readonly (string | undefined)[];
  unreadablePrefix?: boolean;
  /** True when the first argument was the mount path, so the targets begin at the second. */
  consumed: boolean;
};

/** One router-shaped `.use()` argument: the binding it names and the export it narrows to. */
type MountTarget = {
  target: string;
  targetBinding?: string;
};

/** One row of a mount table: each key of an object literal, pointing at its value. */
type TableRow = ReadonlyMap<string, Slice>;

/** A loop that walks a mount table, and the binding its body reads one row through. */
type MountLoop = {
  /** Half-open bounds of the body, so a `.use()` can be told to be inside it. */
  start: number;
  end: number;
  parameter: string;
  /** The name being iterated, which the table is looked up by. */
  source: string;
};

/** An assignment target's head, and whether the target is a plain name or a property. */
type TargetHead = {
  start: number;
  end: number;
  bare: boolean;
};

/** A `.use()` with no path argument: the targets start at the first. */
const NO_MOUNT_PATH: MountPath = { prefixes: [undefined], consumed: false };

/** A file that never names express declares no router, whatever else it assigns. */
const NO_RECEIVERS: ReadonlySet<string> = new Set<string>();

/** A path argument that is present but not readable, so the mount reports without it. */
const UNREADABLE_MOUNT_PATH: MountPath = {
  prefixes: [undefined],
  unreadablePrefix: true,
  consumed: true,
};

/** Express route calls on an app or router declared in the same file. */
export const expressAdapter: FrameworkAdapter = {
  name: "express",
  extensions: EXTENSIONS,
  matches: (files) => files.some((file) => isSource(file.path) && IMPORT_PATTERN.test(file.text)),
  extract: (file) => extractExpressFile(file),
};

function isSource(path: string): boolean {
  return EXTENSIONS.some((extension) => path.endsWith(extension));
}

/**
 * Every fact one file states: the routes it declares, and the links that let a
 * mount in another file reach them. Nothing is resolved here — a binding is
 * reported under the name this file uses for it, and `scan.ts` joins the names
 * up across files, so one resolver serves every framework.
 */
function extractExpressFile(file: SourceFile): FileRoutes {
  // A barrel that only passes a router along names express nowhere, and is still the
  // link a mount in a third file has to travel to reach the routes. Its exports are
  // read for that reason; without an export there is nothing for a mount to reach.
  const declaresRouters = IMPORT_PATTERN.test(file.text);
  if (!declaresRouters && !EXPORT_HINT_PATTERN.test(file.text)) {
    return { routes: [], exported: [], imports: {}, mounts: [] };
  }
  const code = maskNonCode(file.text);
  const declared = declaresRouters ? routeReceivers(code) : NO_RECEIVERS;
  const imports = importedBindings(file.text, code);
  // A router handed to an exported function is a receiver too, and one whose prefix lives
  // in the caller's file, so the two kinds are kept apart and rejoined only here.
  const parameters = declaresRouters ? parameterReceivers(file.text, code, declared) : NO_RECEIVERS;
  const receivers = parameters.size === 0 ? declared : new Set([...declared, ...parameters]);
  if (receivers.size === 0) {
    return {
      routes: [],
      exported: exportedBindings(file.text, code, receivers, imports),
      imports: imports.specifiers,
      mounts: [],
    };
  }
  const routes = localRoutes(file, code, receivers);
  const mounts = mountEdges(file.text, code, receivers, imports);
  return {
    routes,
    exported: exportedBindings(file.text, code, receivers, imports),
    imports: imports.specifiers,
    mounts: [...mounts, ...parameterMounts(parameters, routes, mounts)],
  };
}

/**
 * Blanks comments and literal contents, keeping every offset and newline, so a
 * route in a comment or inside a string is not code and cannot be discovered.
 * Quote characters survive, so the masked text still shows where a literal is.
 */
function maskNonCode(text: string): string {
  const out = text.split("");
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (char === "/" && next === "/") {
      const end = endOfLine(text, index);
      blankRange(out, text, index, end);
      index = end;
      continue;
    }
    if (char === "/" && next === "*") {
      const close = text.indexOf("*/", index + 2);
      const end = close < 0 ? text.length : close + 2;
      blankRange(out, text, index, end);
      index = end;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      index = maskLiteral(out, text, index);
      continue;
    }
    index += 1;
  }
  return out.join("");
}

/**
 * A quoted string ends at its quote, and — for `'` and `"` — at the newline too:
 * an apostrophe in a regex literal then costs one line rather than the whole file.
 */
function maskLiteral(out: string[], text: string, start: number): number {
  const quote = text.charAt(start);
  let index = start + 1;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "\\") {
      blankRange(out, text, index, index + 2);
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    if (char === "\n" && quote !== "`") return index;
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

/** Only a name assigned from Express itself is a route receiver; `cache.get()` is not. */
function routeReceivers(code: string): Set<string> {
  const receivers = new Set<string>();
  for (const match of code.matchAll(RECEIVER_PATTERN)) {
    const name = match[1];
    // The pattern stops at the name nearest the `=`, which in a chained assignment is the
    // last target rather than the binding the rest of the file goes on to use.
    if (name) receivers.add(chainedReceiver(code, match.index ?? 0) ?? name);
  }
  return receivers;
}

/**
 * The name a chained assignment really declares. `var app = module.exports = express()`
 * assigns to `app` first, and the receiver pattern matches at the nearest name before the
 * `=`, which is `exports` — a property of `module`, not a binding any later statement can
 * name. Walking the chain leftwards, one whole target at a time, finds the one that is:
 * the leftmost plain name in it, since every target in a chain is handed the same value
 * and only a plain name is one the rest of the file can call the router by.
 *
 * Nothing is returned when no target in the chain is a plain name, so a lone
 * `module.exports = express()` keeps reading exactly as it did before.
 */
function chainedReceiver(code: string, start: number): string | undefined {
  let cursor = start;
  let name: string | undefined;
  for (let step = 0; step < MAX_ASSIGNMENT_LINKS; step += 1) {
    const head = targetHead(code, cursor);
    if (head === undefined) return name;
    if (head.bare) name = code.slice(head.start, head.end);
    const previous = assignedBefore(code, head.start);
    if (previous === undefined) return name;
    cursor = previous;
  }
  return name;
}

/**
 * The head of the assignment target whose last identifier begins at `cursor`, walked back
 * through `a.b.c` one property at a time. `bare` says the target is a plain name; a
 * property binds nothing a later statement can name, so the chain has to be walked past it.
 */
function targetHead(code: string, cursor: number): TargetHead | undefined {
  let start = cursor;
  let end = cursor;
  while (end < code.length && IDENTIFIER_CHAR_PATTERN.test(code.charAt(end))) end += 1;
  if (end === start) return undefined;
  let bare = true;
  for (let step = 0; step < MAX_ASSIGNMENT_LINKS; step += 1) {
    const dot = skipSpaceBack(code, start - 1);
    if (dot < 0 || code.charAt(dot) !== ".") break;
    const tail = skipSpaceBack(code, dot - 1);
    const head = identifierStart(code, tail);
    // `routers()[0].app` reads off something this scan cannot name, so it names nothing.
    if (head === undefined) return undefined;
    start = head;
    end = tail + 1;
    bare = false;
  }
  return { start, end, bare };
}

/** Where the target of the assignment ending just before `position` starts, if there is one. */
function assignedBefore(code: string, position: number): number | undefined {
  const equals = skipSpaceBack(code, position - 1);
  if (equals < 0 || code.charAt(equals) !== "=") return undefined;
  // `==`, `>=` and `+=` assign nothing to the name on their left, and `=>` opens a body.
  if (equals > 0 && OPERATOR_CHAR_PATTERN.test(code.charAt(equals - 1))) return undefined;
  const after = code.charAt(equals + 1);
  if (after === "=" || after === ">") return undefined;
  return identifierStart(code, skipSpaceBack(code, equals - 1));
}

function skipSpace(code: string, index: number): number {
  let position = index;
  while (position < code.length && SPACE_CHAR_PATTERN.test(code.charAt(position))) position += 1;
  return position;
}

function skipSpaceBack(code: string, index: number): number {
  let position = index;
  while (position >= 0 && SPACE_CHAR_PATTERN.test(code.charAt(position))) position -= 1;
  return position;
}

/** Start of the identifier ending at `end`, or nothing when what ends there is not one. */
function identifierStart(code: string, end: number): number | undefined {
  if (end < 0 || !IDENTIFIER_CHAR_PATTERN.test(code.charAt(end))) return undefined;
  let start = end;
  while (start > 0 && IDENTIFIER_CHAR_PATTERN.test(code.charAt(start - 1))) start -= 1;
  // A digit opens a number, never a name.
  return NAME_START_PATTERN.test(code.charAt(start)) ? start : undefined;
}

/**
 * Parameters an exported function uses as a router. `export default (app) => { ... }` is
 * handed its router by whoever calls it, so the name is never assigned from `express()`
 * and everything hung off it reads as belonging to nothing at all. Only a parameter
 * actually used as a receiver counts — of `.use()`, or of a route method naming a path —
 * so an ordinary callback parameter is never mistaken for a router.
 */
function parameterReceivers(
  text: string,
  code: string,
  declared: ReadonlySet<string>,
): Set<string> {
  const parameters = new Set<string>();
  for (const match of code.matchAll(EXPORTED_FUNCTION_PATTERN)) {
    const [whole, parameter] = match;
    if (!whole || !parameter || declared.has(parameter) || parameters.has(parameter)) continue;
    const body = bodyAfter(code, (match.index ?? 0) + whole.length);
    if (body !== undefined && usedAsRouter(text, code, body, parameter)) parameters.add(parameter);
  }
  return parameters;
}

/**
 * Whether one name is used as a router inside a body. A route path has to start at the
 * root: `req.get('Content-Type')` is a header read, and taking it for a route would
 * invent an endpoint out of a parameter that was never a router at all.
 */
function usedAsRouter(text: string, code: string, body: Slice, parameter: string): boolean {
  for (const match of code.matchAll(USE_PATTERN)) {
    const index = match.index ?? 0;
    if (match[1] === parameter && index >= body.start && index < body.end) return true;
  }
  for (const match of code.matchAll(ROUTE_PATTERN)) {
    const [whole, receiver] = match;
    const index = match.index ?? 0;
    if (!whole || receiver !== parameter || index < body.start || index >= body.end) continue;
    if (literalAt(text, code, index + whole.length - 1)?.startsWith("/")) return true;
  }
  return false;
}

/**
 * The body a head opens: the braced block when one follows it, and otherwise the single
 * statement an arrow or a braceless loop carries. Bounded at both ends, so an unbalanced
 * brace costs one body's worth of scanning rather than the file's.
 */
function bodyAfter(code: string, from: number): Slice | undefined {
  const brace = code.indexOf("{", from);
  // A `;` before the brace ends the statement, so the brace belongs to whatever is next.
  if (brace >= 0 && brace - from <= MAX_HEAD_SPAN && !code.slice(from, brace).includes(";")) {
    const close = closingPair(code, brace, "}", MAX_FUNCTION_SPAN);
    if (close !== undefined) return { start: brace, end: close };
  }
  const semicolon = code.indexOf(";", from);
  const limit = Math.min(code.length, from + MAX_LOOP_SPAN);
  const end = semicolon < 0 ? limit : Math.min(semicolon + 1, limit);
  return end > from ? { start: from, end } : undefined;
}

/**
 * The mount a router parameter stands for. Whoever calls the function decides where the
 * routes below it land, and that call is in a file nothing here ties back to this one, so
 * the prefix is unknown rather than absent. Reporting it as unreadable is what stops
 * `scan.ts` publishing the short path as though it were the whole one: the confidence of
 * every route underneath drops, and the mount is recorded in `unresolvedMounts`.
 *
 * Only a parameter that carries something is worth an edge. One used solely to install
 * middleware moves no route, and flagging it would be an entry nobody can act on.
 */
function parameterMounts(
  parameters: ReadonlySet<string>,
  routes: readonly LocalRoute[],
  mounts: readonly MountEdge[],
): MountEdge[] {
  const edges: MountEdge[] = [];
  for (const parameter of parameters) {
    const carries = routes.some((route) => route.owner === parameter)
      || mounts.some((mount) => mount.host === parameter);
    if (carries) edges.push({ target: parameter, unreadablePrefix: true });
  }
  return edges;
}

/** Reads the literal from the original text at an offset the masked text located. */
function literalAt(text: string, code: string, quoteIndex: number): string | undefined {
  const quote = code.charAt(quoteIndex);
  const start = quoteIndex + 1;
  const offset = code.slice(start, start + MAX_CALL_SPAN).indexOf(quote);
  if (offset < 0) return undefined;
  const raw = text.slice(start, start + offset);
  if (quote !== "`" && raw.includes("\n")) return undefined;
  return raw;
}

/**
 * Offset just past the closing quote of the literal opening at `quoteIndex`, so a
 * caller can tell a literal that fills its argument from one that only starts it.
 */
function literalEnd(code: string, quoteIndex: number): number | undefined {
  const quote = code.charAt(quoteIndex);
  const start = quoteIndex + 1;
  const offset = code.slice(start, start + MAX_CALL_SPAN).indexOf(quote);
  return offset < 0 ? undefined : start + offset + 1;
}

/**
 * Every binding this file gets from somewhere else, under the specifier it came from
 * and — when it was imported by name — under the name it carries there. Which of them
 * are routers cannot be known from one file, so all of them are reported and the
 * resolver decides.
 *
 * `export { usersRouter } from './users'` binds nothing locally, and is recorded here
 * all the same: the resolver's question is which file a name comes from, and for a
 * re-export the answer is the one the clause states.
 */
function importedBindings(text: string, code: string): ImportFacts {
  const facts: ImportFacts = { specifiers: {}, names: {} };

  for (const match of code.matchAll(REQUIRE_PATTERN)) {
    const [whole, binding] = match;
    const index = match.index ?? 0;
    if (!whole || !binding) continue;
    const specifier = literalAt(text, code, index + whole.length - 1);
    if (specifier === undefined) continue;
    recordImports(facts, requireEntries(binding), specifier);
  }

  for (const match of code.matchAll(ESM_IMPORT_PATTERN)) {
    const [whole, clause] = match;
    const index = match.index ?? 0;
    if (!whole || !clause) continue;
    const specifier = literalAt(text, code, index + whole.length - 1);
    if (specifier === undefined) continue;
    recordImports(facts, esmEntries(clause), specifier);
  }

  // Under the name the clause exports, not the one it reads: `{ default as usersRouter }`
  // is reachable from another file as `usersRouter` and under no other name.
  for (const match of code.matchAll(EXPORT_FROM_PATTERN)) {
    const [whole, list] = match;
    const index = match.index ?? 0;
    if (!whole || !list) continue;
    const specifier = literalAt(text, code, index + whole.length - 1);
    if (specifier === undefined) continue;
    recordImports(facts, wholeModuleEntries(list), specifier);
  }

  return facts;
}

/**
 * Files a binding in. A later import of the same local name replaces the earlier one
 * outright, exported name included, so a whole-module import never keeps a stale
 * narrowing from a named one it shadows.
 */
function recordImports(
  facts: ImportFacts,
  entries: readonly ImportedBinding[],
  specifier: string,
): void {
  for (const entry of entries) {
    facts.specifiers[entry.local] = specifier;
    if (entry.imported === undefined) delete facts.names[entry.local];
    else facts.names[entry.local] = entry.imported;
  }
}

/** `const { a, b: c } = require(...)` binds `a` and `c`; `const r: Router = require(...)` binds `r`. */
function requireEntries(binding: string): readonly ImportedBinding[] {
  const trimmed = binding.trim();
  if (trimmed.startsWith("{")) {
    const close = trimmed.lastIndexOf("}");
    return namedEntries(close < 0 ? trimmed : trimmed.slice(0, close + 1));
  }
  const head = IDENTIFIER_HEAD_PATTERN.exec(trimmed);
  return head?.[1] ? [{ local: head[1] }] : [];
}

/**
 * `import users, { a as b } from './x'`. Only the braced group names exports; a
 * default or namespace binding stands for the whole module and narrows nothing.
 */
function esmEntries(clause: string): readonly ImportedBinding[] {
  const open = clause.indexOf("{");
  const close = clause.lastIndexOf("}");
  if (open < 0 || close < open) return wholeModuleEntries(clause);
  return [
    ...wholeModuleEntries(clause.slice(0, open)),
    ...namedEntries(clause.slice(open + 1, close)),
    ...wholeModuleEntries(clause.slice(close + 1)),
  ];
}

/** Bindings that stand for a module rather than for one of its exports. */
function wholeModuleEntries(list: string): readonly ImportedBinding[] {
  return listBindings(list).map((local) => ({ local }));
}

/**
 * Entries of a named import list, under both names each one has: `{ usersRouter: u }`
 * binds `u` here to the export `usersRouter` there, and `{ usersRouter }` binds it to
 * itself. The local name is the last in the entry and the exported name the first, so
 * a mount of the local name can be narrowed to the one export it really reaches.
 */
function namedEntries(list: string): readonly ImportedBinding[] {
  const entries: ImportedBinding[] = [];
  for (const entry of list.replace(BRACE_PATTERN, ",").split(",")) {
    const declared = entry.split("=")[0]?.trim() ?? "";
    if (!declared || TYPE_ENTRY_PATTERN.test(declared)) continue;
    const local = IDENTIFIER_TAIL_PATTERN.exec(declared);
    if (!local?.[1]) continue;
    // An entry whose head will not parse still narrows to the name it binds: naming the
    // wrong export costs a flagged mount, naming none silently prefixes every router.
    const imported = IDENTIFIER_HEAD_PATTERN.exec(declared);
    entries.push({ local: local[1], imported: imported?.[1] ?? local[1] });
  }
  return entries;
}

/**
 * The local names in a binding list: `{ a, b: c }` binds `c`, `{ x as y }` binds
 * `y`, and `{ users: router }` exposes `router` — in every one of them the local
 * name is the last in the entry.
 */
function listBindings(list: string): readonly string[] {
  const names: string[] = [];
  for (const entry of list.replace(BRACE_PATTERN, ",").split(",")) {
    const declared = entry.split("=")[0]?.trim() ?? "";
    if (!declared || TYPE_ENTRY_PATTERN.test(declared)) continue;
    const name = IDENTIFIER_TAIL_PATTERN.exec(declared);
    if (name?.[1]) names.push(name[1]);
  }
  return names;
}

/** Every route declared here, each under the receiver it was declared on. */
function localRoutes(file: SourceFile, code: string, receivers: ReadonlySet<string>): LocalRoute[] {
  const lines = lineOffsets(file.text);
  const routes: LocalRoute[] = [];

  for (const match of code.matchAll(ROUTE_PATTERN)) {
    const [whole, receiver, method] = match;
    const index = match.index ?? 0;
    if (!receiver || !method || !whole || !receivers.has(receiver)) continue;
    const path = literalAt(file.text, code, index + whole.length - 1);
    if (path === undefined) continue;
    routes.push(...ownedBy(receiver, routesFor(file, lines, index, method, path)));
  }

  for (const match of code.matchAll(ROUTE_CHAIN_PATTERN)) {
    const [whole, receiver] = match;
    const index = match.index ?? 0;
    if (!receiver || !whole || !receivers.has(receiver)) continue;
    const path = literalAt(file.text, code, index + whole.length - 1);
    if (path === undefined) continue;
    const open = code.indexOf("(", index);
    const call = open < 0 ? undefined : closingPair(code, open, ")");
    if (call === undefined) continue;
    for (const method of chainedMethods(code, call)) {
      routes.push(...ownedBy(receiver, routesFor(file, lines, index, method, path)));
    }
  }

  return routes;
}

/**
 * Bounded so an unbalanced file cannot make the whole scan quadratic. The bound is the
 * caller's, because a mount table and a function body run longer than an argument list
 * and each still has to have one.
 */
function closingPair(
  code: string,
  open: number,
  close: string,
  span: number = MAX_CALL_SPAN,
): number | undefined {
  const opener = code.charAt(open);
  const limit = Math.min(code.length, open + span);
  let depth = 0;
  for (let index = open; index < limit; index += 1) {
    const char = code.charAt(index);
    if (char === opener) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return undefined;
}

/**
 * Walks the actual chained expression: each link must begin where the previous
 * call ended, so unrelated code after the statement is never read as a link.
 */
function chainedMethods(code: string, start: number): string[] {
  const methods: string[] = [];
  let index = start;
  while (methods.length < MAX_CHAIN_LINKS) {
    const link = CHAINED_METHOD_PATTERN.exec(code.slice(index, index + MAX_CALL_SPAN));
    const method = link?.[1];
    if (!link || !method) break;
    const call = closingPair(code, index + link[0].length - 1, ")");
    if (call === undefined) break;
    methods.push(method);
    index = call;
  }
  return methods;
}

function routesFor(
  file: SourceFile,
  lines: readonly number[],
  index: number,
  method: string,
  path: string,
): DiscoveredEndpoint[] {
  const location = `${file.path}:${lineAt(lines, index)}`;
  const template = normalizePathTemplate(interpolatedPath(path));
  return expandMethod(method).map((entry) => ({
    method: entry,
    path_template: template,
    source_location: location,
    confidence: ROUTE_CONFIDENCE,
  }));
}

/**
 * A template literal's `${version}` becomes `{version}`: the route is real and a
 * substituted segment is exactly what a path template's placeholder means, so
 * dropping the route would lose more than naming the hole does.
 *
 * This is a reading of a route path only. A mount prefix interpolates to a fixed
 * segment the server then serves literally, so calling it a placeholder there would
 * invite a caller to substitute into a hole that does not exist — see `readablePrefix`.
 */
function interpolatedPath(path: string): string {
  return path.replace(INTERPOLATION_PATTERN, (_, expression: string) => {
    const name = IDENTIFIER_TAIL_PATTERN.exec(expression);
    return `{${name?.[1] ?? "param"}}`;
  });
}

/** `.all()` states every method, so it expands rather than inventing a pseudo-method. */
function expandMethod(method: string): readonly HttpMethod[] {
  if (method.toLowerCase() === "all") return ALL_METHODS;
  const named = httpMethod(method);
  return named ? [named] : [];
}

function httpMethod(value: string): HttpMethod | undefined {
  const method = value.toUpperCase() as HttpMethod;
  return HTTP_METHODS.has(method) ? method : undefined;
}

/** The receiver a route was declared on, so a mount knows which routes it moves. */
function ownedBy(owner: string, endpoints: readonly DiscoveredEndpoint[]): LocalRoute[] {
  return endpoints.map((endpoint) => ({ endpoint, owner }));
}

/**
 * Bindings this file hands to its neighbours, named as this file names them:
 * `module.exports = { users: router }` exposes the local `router`, not `users`.
 *
 * Two kinds survive the filter. A router declared here is one. A binding this file
 * imported and passes on is the other: a barrel declares no router of its own, and
 * dropping what it re-exports strands every mount that goes through it — the routes
 * are then reported without the prefix the barrel was mounted under. Everything else
 * is dropped, so `module.exports = someConfigObject` still exposes nothing.
 */
/**
 * The `require("./x")` call starting at `from`, rebuilt with the specifier it names.
 * Masking blanks a literal's contents, so the path is read back out of the original text
 * and the call reassembled — the resolver reads the specifier straight out of it.
 */
function inlinedModule(text: string, code: string, from: number): string | undefined {
  const head = INLINE_MODULE_CALL_PATTERN.exec(code.slice(from, from + MAX_HEAD_SPAN));
  const quote = head?.[1];
  if (!head || !quote) return undefined;
  const specifier = literalAt(text, code, from + head[0].indexOf(quote));
  return specifier?.startsWith(".") ? `require("${specifier}")` : undefined;
}

function exportedBindings(
  text: string,
  code: string,
  receivers: ReadonlySet<string>,
  imports: ImportFacts,
): string[] {
  const names: string[] = [];

  for (const match of code.matchAll(MODULE_EXPORTS_PATTERN)) {
    const [whole, value] = match;
    const index = match.index ?? 0;
    if (!whole || !value) continue;
    if (value !== "{") {
      // `module.exports = express()` exposes what the call returned, and the name in front
      // of the parenthesis is the factory rather than the binding. The chain names the
      // binding instead: in `var app = module.exports = express()` the file exposes `app`,
      // which is also what carries the routes, so the two ends of a mount can meet.
      if (code.charAt(skipSpace(code, index + whole.length)) === "(") {
        // `module.exports = require("./users")` re-exports another file's router without
        // ever binding it here, so the call itself is the only name for what is exposed.
        // Reported verbatim so the resolver can read the specifier straight out of it.
        const inlined = inlinedModule(text, code, index + whole.length - value.length);
        if (inlined) {
          names.push(inlined);
          continue;
        }
        const target = assignedBefore(code, index);
        const chained = target === undefined ? undefined : chainedReceiver(code, target);
        if (chained) names.push(chained);
        continue;
      }
      names.push(value);
      continue;
    }
    const open = index + whole.length - 1;
    const close = closingPair(code, open, "}");
    if (close === undefined) continue;
    names.push(...listBindings(code.slice(open + 1, close - 1)));
  }

  for (const match of code.matchAll(EXPORTS_PROPERTY_PATTERN)) {
    const name = match[1];
    if (name) names.push(name);
  }

  for (const match of code.matchAll(EXPORT_DEFAULT_PATTERN)) {
    const name = match[1];
    if (name) names.push(name);
  }

  for (const match of code.matchAll(EXPORT_LIST_PATTERN)) {
    const list = match[1];
    if (list) names.push(...exportListBindings(list));
  }

  for (const match of code.matchAll(EXPORT_DECLARATION_PATTERN)) {
    const name = match[1];
    if (name) names.push(name);
  }

  // `export { a as b } from './x'` exposes `b`, the opposite end of the entry from the
  // local-name reading above, because no local `a` exists here for a mount to reach.
  for (const match of code.matchAll(EXPORT_FROM_PATTERN)) {
    const list = match[1];
    if (list) names.push(...listBindings(list));
  }

  // A router declared here, a binding imported here, or a module named inline by the
  // export itself. Anything else is not a router, so `module.exports = someConfig`
  // still exposes nothing.
  return [...new Set(names)].filter((name) =>
    receivers.has(name)
    || lookup(imports.specifiers, name) !== undefined
    || INLINE_MODULE_CALL_PATTERN.test(name));
}

/** `export { router as usersRouter }` exposes the local `router`: the name before `as`. */
function exportListBindings(list: string): readonly string[] {
  const names: string[] = [];
  for (const entry of list.split(",")) {
    const head = IDENTIFIER_HEAD_PATTERN.exec(entry.trim());
    if (head?.[1]) names.push(head[1]);
  }
  return names;
}

/**
 * The `app.use(prefix, router)` edges stated here, reported and never resolved.
 * A prefix that is not a readable literal is flagged rather than guessed: a
 * wrong prefix is a wrong endpoint, while a missing one is only a route that
 * stays where it was declared. An array of paths is not one mount but several,
 * since Express answers on every path in it, so it yields one edge apiece.
 */
function mountEdges(
  text: string,
  code: string,
  receivers: ReadonlySet<string>,
  imports: ImportFacts,
): MountEdge[] {
  const mounts: MountEdge[] = [];
  const tables = mountTables(code);
  const loops = mountLoops(code);
  const walked = new Set<string>();

  for (const match of code.matchAll(USE_PATTERN)) {
    const [whole, receiver] = match;
    const index = match.index ?? 0;
    if (!whole || !receiver || !receivers.has(receiver)) continue;
    const open = index + whole.length - 1;
    const call = closingPair(code, open, ")");
    if (call === undefined) continue;
    const args = callArguments(code, open, call);
    const first = args[0];
    if (!first) continue;

    // A mount inside a loop states one row of a table, and the table holds the prefixes.
    const loop = enclosingLoop(loops, index);
    const rows = loop
      ? tableMounts(text, code, loop, tables.get(loop.source), receiver, args, receivers, imports)
      : undefined;
    if (loop && rows) {
      walked.add(loop.source);
      mounts.push(...rows);
      continue;
    }

    const path = mountPath(text, code, first, args.length);
    for (const slice of path.consumed ? args.slice(1) : args) {
      const target = mountTarget(text, code, slice, receivers, imports);
      if (target === undefined) continue;
      for (const prefix of path.prefixes) {
        mounts.push(omitUndefined({
          target: target.target,
          targetBinding: target.targetBinding,
          host: receiver,
          prefix,
          unreadablePrefix: path.unreadablePrefix,
        }));
      }
    }
  }

  mounts.push(...unwalkedTables(code, tables, walked, receivers, imports));
  return mounts;
}

/** The tightest loop a `.use()` sits in, so nesting reads the row binding nearest to it. */
function enclosingLoop(loops: readonly MountLoop[], index: number): MountLoop | undefined {
  let found: MountLoop | undefined;
  for (const loop of loops) {
    if (index <= loop.start || index >= loop.end) continue;
    if (found === undefined || loop.end - loop.start < found.end - found.start) found = loop;
  }
  return found;
}

/**
 * Array literals of object literals, under the name each was bound to. Only the literal is
 * read: an array assembled anywhere else states no path this scan can value, and the loop
 * that walks it is reported as unreadable rather than guessed at.
 */
function mountTables(code: string): Map<string, readonly TableRow[]> {
  const tables = new Map<string, readonly TableRow[]>();
  for (const match of code.matchAll(ARRAY_TABLE_PATTERN)) {
    const [whole, name] = match;
    if (!whole || !name || tables.has(name)) continue;
    const open = (match.index ?? 0) + whole.length - 1;
    const close = closingPair(code, open, "]", MAX_TABLE_SPAN);
    if (close === undefined) continue;
    const rows: TableRow[] = [];
    let literal = true;
    for (const element of callArguments(code, open, close)) {
      // A trailing comma leaves an empty element behind, which states nothing either way.
      if (code.slice(element.start, element.end).trim() === "") continue;
      const row = objectRow(code, element);
      if (row === undefined) {
        literal = false;
        break;
      }
      rows.push(row);
    }
    if (literal && rows.length > 0) tables.set(name, rows);
  }
  return tables;
}

/** One object literal read as a row: each key, pointing at the slice its value fills. */
function objectRow(code: string, element: Slice): TableRow | undefined {
  const body = code.slice(element.start, element.end);
  const open = element.start + body.length - body.trimStart().length;
  if (code.charAt(open) !== "{") return undefined;
  const close = closingPair(code, open, "}", MAX_TABLE_SPAN);
  if (close === undefined) return undefined;
  const row = new Map<string, Slice>();
  for (const property of callArguments(code, open, close)) {
    const head = code.slice(property.start, property.end);
    const keyed = OBJECT_KEY_PATTERN.exec(head);
    if (keyed?.[1]) {
      row.set(keyed[1], { start: property.start + keyed[0].length, end: property.end });
      continue;
    }
    // `{ path, route }`: the key names the value too.
    const shorthand = SHORTHAND_KEY_PATTERN.exec(head);
    if (shorthand?.[1]) row.set(shorthand[1], property);
  }
  return row;
}

/**
 * Loops that walk a table row by row, with the bounds of the body and the binding one row
 * is read through. Both spellings of the idiom are read: `table.forEach((row) => ...)` and
 * `for (const row of table)`.
 */
function mountLoops(code: string): MountLoop[] {
  const loops: MountLoop[] = [];

  for (const match of code.matchAll(FOREACH_PATTERN)) {
    const [whole, source] = match;
    if (!whole || !source) continue;
    const open = (match.index ?? 0) + whole.length - 1;
    const close = closingPair(code, open, ")", MAX_LOOP_SPAN);
    if (close === undefined) continue;
    const head = code.slice(open + 1, Math.min(close, open + MAX_HEAD_SPAN));
    const parsed = CALLBACK_PARAMETER_PATTERN.exec(head);
    const parameter = parsed?.[1] ?? parsed?.[2];
    if (parameter) loops.push({ start: open, end: close, parameter, source });
  }

  for (const match of code.matchAll(FOR_OF_PATTERN)) {
    const [whole, parameter, source] = match;
    if (!whole || !parameter || !source) continue;
    const body = bodyAfter(code, (match.index ?? 0) + whole.length);
    if (body) loops.push({ start: body.start, end: body.end, parameter, source });
  }

  return loops;
}

/**
 * The edges a table-driven mount states, or nothing when the call reads no row at all and
 * is an ordinary mount that happens to sit inside a loop.
 *
 * `router.use(route.path, route.route)` inside `defaultRoutes.forEach((route) => ...)` is
 * one mount per row of `defaultRoutes`. Both keys are taken from the call rather than
 * assumed, so a table written `{ prefix, router }` reads exactly the same way. A row this
 * scan cannot value — a path that is not a string literal, a target that names no module,
 * or a table that is not an array literal — becomes an unreadable mount instead, so the
 * routes below are never published under a prefix nobody read.
 */
function tableMounts(
  text: string,
  code: string,
  loop: MountLoop,
  table: readonly TableRow[] | undefined,
  receiver: string,
  args: readonly Slice[],
  receivers: ReadonlySet<string>,
  imports: ImportFacts,
): MountEdge[] | undefined {
  const first = args[0];
  const second = args[1];
  const pathKey = first && rowProperty(code, first, loop.parameter);
  const routeKey = second && rowProperty(code, second, loop.parameter);
  if (!pathKey && !routeKey) return undefined;
  // A one-argument `.use()` installs middleware from the row; there is no prefix in it.
  // The row was still read, so the table counts as walked and nothing is flagged.
  if (second === undefined) return [];
  if (!pathKey || !routeKey || table === undefined) return [unreadableTable(loop, receiver)];

  const edges: MountEdge[] = [];
  let flagged = false;
  for (const row of table) {
    const value = row.get(routeKey);
    const target = value && mountTarget(text, code, value, receivers, imports);
    if (!target) {
      // A call in the row is middleware rather than a router, and `mountTarget` leaves
      // those alone for the reason it states: flagging every `express.json()` would bury
      // the mounts that matter. Anything else names something, and skipping it is silence.
      if (value === undefined || code.slice(value.start, value.end).includes("(")) continue;
      // One entry says the table was seen and not followed; a second says nothing more.
      if (!flagged) edges.push(unreadableTable(loop, receiver));
      flagged = true;
      continue;
    }
    const path = row.get(pathKey);
    const prefix = path && literalPrefix(text, code, path);
    edges.push(omitUndefined({
      target: target.target,
      targetBinding: target.targetBinding,
      host: receiver,
      prefix,
      unreadablePrefix: prefix === undefined ? true : undefined,
    }));
  }
  return edges;
}

/**
 * Tables walked by a loop no mount could be read out of — a callback passed by name, or a
 * body that mounts onto something this file never declared. The array is a literal and it
 * holds routers, so a prefix is being applied somewhere and nothing here says where.
 * Reported as one unfollowed mount, since the alternative is silence.
 */
function unwalkedTables(
  code: string,
  tables: ReadonlyMap<string, readonly TableRow[]>,
  walked: ReadonlySet<string>,
  receivers: ReadonlySet<string>,
  imports: ImportFacts,
): MountEdge[] {
  if (tables.size === 0) return [];
  const iterated = new Set<string>();
  for (const match of code.matchAll(FOREACH_PATTERN)) {
    const source = match[1];
    if (source) iterated.add(source);
  }
  for (const match of code.matchAll(FOR_OF_PATTERN)) {
    const source = match[2];
    if (source) iterated.add(source);
  }
  const edges: MountEdge[] = [];
  for (const [name, table] of tables) {
    if (walked.has(name) || !iterated.has(name)) continue;
    if (holdsRouters(code, table, receivers, imports)) {
      edges.push({ target: name, unreadablePrefix: true });
    }
  }
  return edges;
}

/** Whether a table names anything this file could mount, so a loop over it is a mount. */
function holdsRouters(
  code: string,
  table: readonly TableRow[],
  receivers: ReadonlySet<string>,
  imports: ImportFacts,
): boolean {
  return table.some((row) => [...row.values()].some((slice) => {
    const name = MOUNT_TARGET_PATTERN.exec(code.slice(slice.start, slice.end))?.[1];
    return name !== undefined
      && (receivers.has(name) || lookup(imports.specifiers, name) !== undefined);
  }));
}

/** The one edge a table the scan could not value is worth: seen, unfollowed, and said so. */
function unreadableTable(loop: MountLoop, receiver: string): MountEdge {
  return { target: loop.source, host: receiver, unreadablePrefix: true };
}

/** `route.path` read against the loop's row binding, giving the key it indexes with. */
function rowProperty(code: string, slice: Slice, parameter: string): string | undefined {
  const parsed = PARAMETER_PROPERTY_PATTERN.exec(code.slice(slice.start, slice.end));
  if (!parsed || parsed[1] !== parameter) return undefined;
  return parsed[2];
}

/** Where a `.use()` call hangs its targets, read from the call's first argument. */
function mountPath(text: string, code: string, first: Slice, count: number): MountPath {
  const head = code.slice(first.start, first.end);
  const lead = first.start + head.length - head.trimStart().length;
  const char = code.charAt(lead);

  if (QUOTE_PATTERN.test(char)) {
    const prefix = readablePrefix(text, code, lead, first.end);
    return prefix === undefined ? UNREADABLE_MOUNT_PATH : { prefixes: [prefix], consumed: true };
  }
  if (char === "[") return arrayMountPath(text, code, lead);
  if (count > 1 && !NOT_A_PREFIX_PATTERN.test(head)) return UNREADABLE_MOUNT_PATH;
  return NO_MOUNT_PATH;
}

/**
 * The prefix a quoted argument states, or nothing when it states a value instead.
 *
 * Two shapes start with a readable literal and are not one. `'/api/' + version` mounts
 * at `/api/v2`, so reading the literal alone puts every route under a path the server
 * has nothing at. `` `/api/${version}` `` mounts at a fixed segment the server serves
 * literally, so naming it `{version}` invites a caller to substitute into a hole that
 * is not there. Both are prefixes this scan cannot value, and an unreadable prefix
 * costs a flagged mount while a wrongly read one costs a fabricated endpoint.
 */
function readablePrefix(text: string, code: string, lead: number, end: number): string | undefined {
  const close = literalEnd(code, lead);
  if (close === undefined || code.slice(close, end).trim() !== "") return undefined;
  const literal = literalAt(text, code, lead);
  if (literal === undefined || HAS_INTERPOLATION_PATTERN.test(literal)) return undefined;
  return normalizePathTemplate(literal);
}

/**
 * An array first argument. Express mounts at every path in it, so an array of readable
 * literals becomes one edge per literal and the routes below report under each. An
 * element that is not a readable literal makes the whole array unreadable: it may be a
 * path with no readable value, or the array may be a middleware list and no path at
 * all, and neither reading is worth guessing at.
 */
function arrayMountPath(text: string, code: string, lead: number): MountPath {
  const close = closingPair(code, lead, "]");
  if (close === undefined) return UNREADABLE_MOUNT_PATH;
  const prefixes: string[] = [];
  for (const element of callArguments(code, lead, close)) {
    const prefix = literalPrefix(text, code, element);
    if (prefix === undefined) return UNREADABLE_MOUNT_PATH;
    prefixes.push(prefix);
  }
  return prefixes.length > 0 ? { prefixes, consumed: true } : UNREADABLE_MOUNT_PATH;
}

/** The prefix one argument states, when a path literal is the whole of what it holds. */
function literalPrefix(text: string, code: string, slice: Slice): string | undefined {
  const body = code.slice(slice.start, slice.end);
  const lead = slice.start + body.length - body.trimStart().length;
  if (!QUOTE_PATTERN.test(code.charAt(lead))) return undefined;
  return readablePrefix(text, code, lead, slice.end);
}

/**
 * The binding one `.use()` argument mounts, or nothing when the argument names no
 * router this file can be read to reach.
 *
 * A named import narrows the mount to the single export it bound, so
 * `const { usersRouter } = require('./all')` prefixes that router and not every other
 * one the file exports. A dotted argument narrows the same way and is read only when
 * its head is a name this file actually has — an imported binding or a router declared
 * here — because anything else is an attribute expression nothing here can follow and
 * reporting it would invent a link.
 */
function mountTarget(
  text: string,
  code: string,
  slice: Slice,
  receivers: ReadonlySet<string>,
  imports: ImportFacts,
): MountTarget | undefined {
  const parsed = MOUNT_TARGET_PATTERN.exec(code.slice(slice.start, slice.end));
  const name = parsed?.[1];
  if (!name) return inlineModuleTarget(text, code, slice);
  const properties = (parsed?.[2] ?? "").replace(SPACE_PATTERN, "");
  if (!properties) return omitUndefined({ target: name, targetBinding: lookup(imports.names, name) });
  if (lookup(imports.specifiers, name) === undefined && !receivers.has(name)) return undefined;
  return { target: name, targetBinding: properties.slice(1) };
}

/**
 * A local module put straight into `.use()`, as `app.use('/api', require('./routes'))`.
 * There is no binding to resolve it by, so it is reported under the expression as
 * written: `mountedUnits` finds no import of that name and no router declared under it,
 * and `scan.ts` returns the mount in `unresolvedMounts`. A mount reported as unfollowed
 * is worth an entry; one dropped in silence leaves the routes below it looking rooted.
 *
 * A package require and every other call are left alone. `express.json()` and
 * `require('helmet')()` are middleware, and flagging each of those would bury the
 * mounts that matter under entries nobody can act on.
 */
function inlineModuleTarget(text: string, code: string, slice: Slice): MountTarget | undefined {
  const masked = code.slice(slice.start, slice.end);
  if (!INLINE_MODULE_PATTERN.test(masked)) return undefined;
  const quote = masked.search(QUOTE_PATTERN);
  if (quote < 0) return undefined;
  const specifier = literalAt(text, code, slice.start + quote);
  if (specifier === undefined || !specifier.startsWith(".")) return undefined;
  return { target: text.slice(slice.start, slice.end).trim() };
}

/** Own-property lookup, so a binding named `toString` reads as absent, not as inherited. */
function lookup(map: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

/** Top-level arguments of one call, so a nested call or object literal never splits one. */
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
