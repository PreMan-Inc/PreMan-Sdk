import type { HostedMcpCatalog, HostedMcpRecord, HostedMcpTool, JsonSchema } from "./types.js";

export type CatalogSnapshot = {
  version: 1;
  mcpId?: string;
  name?: string;
  upstreamBaseUrl?: string;
  generatedAt: string;
  tools: CatalogToolSnapshot[];
};

export type CatalogToolSnapshot = {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  method?: string;
  path?: string;
};

export type CatalogDiffOptions = {
  allowRemovedTools?: boolean;
  allowRenamedTools?: boolean;
  allowRiskySchemaBroadening?: boolean;
  allowNewWriteTools?: boolean;
};

export type CatalogDiff = {
  added: CatalogToolSnapshot[];
  removed: CatalogToolSnapshot[];
  renamed: Array<{ from: CatalogToolSnapshot; to: CatalogToolSnapshot }>;
  changed: Array<{ before: CatalogToolSnapshot; after: CatalogToolSnapshot; notes: string[] }>;
  blocking: CatalogDiffFinding[];
};

export type CatalogDiffFinding = {
  severity: "error" | "warning";
  code: "removed_tool" | "renamed_tool" | "schema_broadened" | "new_write_tool";
  message: string;
  toolName?: string;
};

export function normalizeHostedMcpCatalog(value: unknown): HostedMcpCatalog {
  const root = asRecord(value) ?? {};
  const hosted = asRecord(root["hosted_mcp"]) ?? root;
  const selection = parseMaybeJson(hosted["endpoint_selection"] ?? root["endpoint_selection"] ?? root["generated_spec"] ?? root);
  const selectionRecord = asRecord(selection);
  const rawTools = Array.isArray(selectionRecord?.["tools"])
    ? selectionRecord["tools"]
    : Array.isArray(selection)
      ? selection
      : [];
  const tools = rawTools.map(normalizeTool).filter((tool): tool is HostedMcpTool => Boolean(tool));

  return {
    mcpId: stringAt(hosted, "id") || stringAt(root, "mcpId") || undefined,
    name: stringAt(hosted, "name") || stringAt(root, "name") || undefined,
    upstreamBaseUrl: stringAt(hosted, "upstream_base_url") || stringAt(selectionRecord, "upstream_base_url") || undefined,
    tools,
    raw: root,
  };
}

export function createCatalogSnapshot(catalog: HostedMcpCatalog, date = new Date()): CatalogSnapshot {
  return {
    version: 1,
    mcpId: catalog.mcpId,
    name: catalog.name,
    upstreamBaseUrl: catalog.upstreamBaseUrl,
    generatedAt: date.toISOString(),
    tools: catalog.tools.map(snapshotTool).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function parseCatalogSnapshot(value: string | unknown): CatalogSnapshot {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const record = asRecord(parsed);
  if (!record || !Array.isArray(record["tools"])) {
    throw new Error("Catalog snapshot must contain a tools array.");
  }
  return {
    version: 1,
    mcpId: stringAt(record, "mcpId") || undefined,
    name: stringAt(record, "name") || undefined,
    upstreamBaseUrl: stringAt(record, "upstreamBaseUrl") || undefined,
    generatedAt: stringAt(record, "generatedAt") || new Date(0).toISOString(),
    tools: record["tools"].map(normalizeSnapshotTool).filter((tool): tool is CatalogToolSnapshot => Boolean(tool)),
  };
}

export function diffCatalogSnapshots(
  approved: CatalogSnapshot,
  current: CatalogSnapshot,
  options: CatalogDiffOptions = {},
): CatalogDiff {
  const approvedByName = new Map(approved.tools.map((tool) => [tool.name, tool]));
  const currentByName = new Map(current.tools.map((tool) => [tool.name, tool]));
  const added = current.tools.filter((tool) => !approvedByName.has(tool.name));
  const removed = approved.tools.filter((tool) => !currentByName.has(tool.name));
  const renamed = detectRenames(removed, added);
  const changed = current.tools
    .map((after) => {
      const before = approvedByName.get(after.name);
      if (!before) return undefined;
      const notes = schemaBroadeningNotes(before.inputSchema, after.inputSchema);
      if (!stableStringify(before.inputSchema) && !stableStringify(after.inputSchema)) return undefined;
      if (notes.length || stableStringify(before.inputSchema) !== stableStringify(after.inputSchema)) {
        return { before, after, notes };
      }
      return undefined;
    })
    .filter((item): item is CatalogDiff["changed"][number] => Boolean(item));

  const blocking: CatalogDiffFinding[] = [];
  if (!options.allowRemovedTools) {
    for (const tool of removed) {
      blocking.push({
        severity: "error",
        code: "removed_tool",
        toolName: tool.name,
        message: `Removed tool: ${tool.name}`,
      });
    }
  }
  if (!options.allowRenamedTools) {
    for (const rename of renamed) {
      blocking.push({
        severity: "error",
        code: "renamed_tool",
        toolName: rename.to.name,
        message: `Possible renamed tool: ${rename.from.name} -> ${rename.to.name}`,
      });
    }
  }
  if (!options.allowRiskySchemaBroadening) {
    for (const change of changed) {
      if (change.notes.length) {
        blocking.push({
          severity: "error",
          code: "schema_broadened",
          toolName: change.after.name,
          message: `Schema broadened for ${change.after.name}: ${change.notes.join("; ")}`,
        });
      }
    }
  }
  if (!options.allowNewWriteTools) {
    for (const tool of added) {
      if (isWriteTool(tool)) {
        blocking.push({
          severity: "error",
          code: "new_write_tool",
          toolName: tool.name,
          message: `New write-capable tool requires approval: ${tool.name}`,
        });
      }
    }
  }

  return { added, removed, renamed, changed, blocking };
}

export function formatCatalogDiff(diff: CatalogDiff): string {
  const lines: string[] = [];
  lines.push(`Added tools: ${diff.added.length}`);
  for (const tool of diff.added) lines.push(`  + ${tool.name}${writeLabel(tool)}`);
  lines.push(`Removed tools: ${diff.removed.length}`);
  for (const tool of diff.removed) lines.push(`  - ${tool.name}`);
  lines.push(`Schema changes: ${diff.changed.length}`);
  for (const change of diff.changed) {
    const note = change.notes.length ? ` (${change.notes.join("; ")})` : "";
    lines.push(`  ~ ${change.after.name}${note}`);
  }
  if (diff.renamed.length) {
    lines.push(`Possible renames: ${diff.renamed.length}`);
    for (const rename of diff.renamed) lines.push(`  > ${rename.from.name} -> ${rename.to.name}`);
  }
  if (diff.blocking.length) {
    lines.push("Blocking findings:");
    for (const finding of diff.blocking) lines.push(`  ${finding.code}: ${finding.message}`);
  } else {
    lines.push("No blocking drift.");
  }
  return `${lines.join("\n")}\n`;
}

function normalizeTool(value: unknown): HostedMcpTool | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const name = stringAt(record, "name");
  if (!name) return undefined;
  const inputSchema = asSchema(record["inputSchema"]) ?? asSchema(record["input_schema"]) ?? {};
  return {
    name,
    description: stringAt(record, "description") || undefined,
    inputSchema,
    input_schema: inputSchema,
    _endpoint_ref: asRecord(record["_endpoint_ref"]) ?? undefined,
  };
}

function snapshotTool(tool: HostedMcpTool): CatalogToolSnapshot {
  const endpoint = asRecord(tool._endpoint_ref) ?? {};
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: asSchema(tool.inputSchema) ?? asSchema(tool.input_schema) ?? {},
    method: stringAt(endpoint, "method") || methodFromName(tool.name) || undefined,
    path: stringAt(endpoint, "path_template") || stringAt(endpoint, "path") || undefined,
  };
}

function normalizeSnapshotTool(value: unknown): CatalogToolSnapshot | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const name = stringAt(record, "name");
  if (!name) return undefined;
  return {
    name,
    description: stringAt(record, "description") || undefined,
    inputSchema: asSchema(record["inputSchema"]) ?? {},
    method: stringAt(record, "method") || methodFromName(name) || undefined,
    path: stringAt(record, "path") || undefined,
  };
}

function detectRenames(removed: CatalogToolSnapshot[], added: CatalogToolSnapshot[]): Array<{ from: CatalogToolSnapshot; to: CatalogToolSnapshot }> {
  const matches: Array<{ from: CatalogToolSnapshot; to: CatalogToolSnapshot }> = [];
  for (const before of removed) {
    const match = added.find((after) =>
      Boolean(before.method && after.method && before.path && after.path && before.method === after.method && before.path === after.path)
      || Boolean(before.description && after.description && before.description === after.description)
    );
    if (match) matches.push({ from: before, to: match });
  }
  return matches;
}

function schemaBroadeningNotes(before: JsonSchema, after: JsonSchema, path = "$"): string[] {
  const notes: string[] = [];
  const beforeRequired = stringSet(before["required"]);
  const afterRequired = stringSet(after["required"]);
  for (const key of beforeRequired) {
    if (!afterRequired.has(key)) notes.push(`${path}.${key} is no longer required`);
  }

  const beforeEnum = arrayAt(before["enum"]);
  const afterEnum = arrayAt(after["enum"]);
  if (beforeEnum && !afterEnum) notes.push(`${path} enum was removed`);
  if (beforeEnum && afterEnum && afterEnum.length > beforeEnum.length) notes.push(`${path} enum accepts more values`);

  const beforeType = typeSet(before["type"]);
  const afterType = typeSet(after["type"]);
  if (beforeType.size && !afterType.size) notes.push(`${path} type constraint was removed`);
  for (const type of afterType) {
    if (beforeType.size && !beforeType.has(type)) notes.push(`${path} accepts new type ${type}`);
  }

  if (before["additionalProperties"] === false && after["additionalProperties"] !== false) {
    notes.push(`${path} now allows additional properties`);
  }

  const beforeProps = asRecord(before["properties"]) ?? {};
  const afterProps = asRecord(after["properties"]) ?? {};
  for (const [key, value] of Object.entries(beforeProps)) {
    const next = asSchema(afterProps[key]);
    if (next) notes.push(...schemaBroadeningNotes(asSchema(value) ?? {}, next, `${path}.${key}`));
  }
  return notes;
}

function isWriteTool(tool: CatalogToolSnapshot): boolean {
  const method = tool.method?.toUpperCase() ?? methodFromName(tool.name);
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method ?? "");
}

function methodFromName(name: string): string | undefined {
  const prefix = name.split("_", 1)[0]?.toUpperCase() ?? "";
  return ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(prefix) ? prefix : undefined;
}

function writeLabel(tool: CatalogToolSnapshot): string {
  return isWriteTool(tool) ? " [write]" : "";
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value === "string" || value instanceof String) {
    try {
      return JSON.parse(String(value));
    } catch {
      return {};
    }
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asSchema(value: unknown): JsonSchema | undefined {
  return asRecord(value);
}

function stringAt(value: Record<string, unknown> | undefined, key: string): string {
  const item = value?.[key];
  return typeof item === "string" ? item : "";
}

function stringSet(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
}

function typeSet(value: unknown): Set<string> {
  if (typeof value === "string") return new Set([value]);
  if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === "string"));
  return new Set();
}

function arrayAt(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]));
}
