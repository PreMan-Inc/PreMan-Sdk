import type { EndpointDefinition, HttpMethod, JsonSchema } from "./types.js";

type JsonObject = Record<string, unknown>;

const HTTP_METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export function fromOpenApi(input: string | JsonObject): EndpointDefinition[] {
  const document = parseInput(input, "OpenAPI");
  const paths = objectAt(document, "paths");
  if (!paths) {
    throw new Error("OpenAPI document must include a paths object.");
  }

  const endpoints: EndpointDefinition[] = [];

  for (const [path, pathItemValue] of Object.entries(paths)) {
    const pathItem = asObject(pathItemValue);
    if (!pathItem) continue;

    for (const [methodName, operationValue] of Object.entries(pathItem)) {
      const method = normalizeMethod(methodName);
      if (!method) continue;
      const operation = asObject(operationValue);
      if (!operation) continue;

      endpoints.push(omitUndefined({
        method,
        path,
        tags: stringArray(operation["tags"]),
        description: stringValue(operation["description"]) ?? stringValue(operation["summary"]),
        requestBodySchema: openApiRequestBodySchema(document, operation),
        responseSchema: openApiResponseSchema(document, operation),
      }));
    }
  }

  return endpoints;
}

export function fromPostmanCollection(input: string | JsonObject): EndpointDefinition[] {
  const collection = parseInput(input, "Postman collection");
  const items = arrayAt(collection, "item");
  if (!items) {
    throw new Error("Postman collection must include an item array.");
  }

  const endpoints: EndpointDefinition[] = [];
  visitPostmanItems(items, [], endpoints);
  return endpoints;
}

function visitPostmanItems(items: unknown[], folderTags: string[], endpoints: EndpointDefinition[]): void {
  for (const itemValue of items) {
    const item = asObject(itemValue);
    if (!item) continue;

    const nestedItems = arrayAt(item, "item");
    if (nestedItems) {
      const folderName = stringValue(item["name"]);
      visitPostmanItems(nestedItems, folderName ? [...folderTags, folderName] : folderTags, endpoints);
      continue;
    }

    const request = asObject(item["request"]);
    if (!request) continue;

    const method = normalizeMethod(stringValue(request["method"]) ?? "GET");
    const path = postmanPath(request["url"]);
    if (!method || !path) continue;

    const tags = folderTags.length ? folderTags : undefined;
    endpoints.push(omitUndefined({
      method,
      path,
      tags,
      description: postmanDescription(request["description"]) ?? postmanDescription(item["description"]),
      requestBodySchema: postmanRequestBodySchema(request),
      responseSchema: postmanResponseSchema(item),
    }));
  }
}

function openApiRequestBodySchema(document: JsonObject, operation: JsonObject): JsonSchema | undefined {
  const requestBody = resolveRef(document, operation["requestBody"]);
  const body = asObject(requestBody);
  if (body) {
    const contentSchema = schemaFromContent(document, body["content"]);
    if (contentSchema) return contentSchema;

    const schema = asSchema(resolveRef(document, body["schema"]));
    if (schema) return schema;
  }

  const parameters = Array.isArray(operation["parameters"]) ? operation["parameters"] : [];
  const bodyParameter = parameters.map((parameter) => resolveRef(document, parameter)).map(asObject).find((parameter) => parameter?.["in"] === "body");
  return asSchema(resolveRef(document, bodyParameter?.["schema"]));
}

function openApiResponseSchema(document: JsonObject, operation: JsonObject): JsonSchema | undefined {
  const responses = asObject(operation["responses"]);
  if (!responses) return undefined;

  const response = preferredResponse(responses);
  if (!response) return undefined;

  const resolved = asObject(resolveRef(document, response));
  if (!resolved) return undefined;

  const contentSchema = schemaFromContent(document, resolved["content"]);
  if (contentSchema) return contentSchema;

  return asSchema(resolveRef(document, resolved["schema"]));
}

function preferredResponse(responses: JsonObject): unknown {
  for (const status of Object.keys(responses).sort()) {
    if (/^2\d\d$/.test(status)) return responses[status];
  }
  return responses["default"] ?? Object.values(responses)[0];
}

function schemaFromContent(document: JsonObject, contentValue: unknown): JsonSchema | undefined {
  const content = asObject(contentValue);
  if (!content) return undefined;

  const mediaType = content["application/json"] ? "application/json" : Object.keys(content)[0];
  if (!mediaType) return undefined;

  const mediaObject = asObject(content[mediaType]);
  if (!mediaObject) return undefined;

  return asSchema(resolveRef(document, mediaObject["schema"]));
}

function postmanPath(urlValue: unknown): string | undefined {
  if (typeof urlValue === "string") return pathFromUrl(urlValue);

  const url = asObject(urlValue);
  if (!url) return undefined;

  const pathParts = arrayAt(url, "path");
  if (pathParts?.length) {
    return `/${pathParts.map((part) => normalizePathSegment(String(part))).filter(Boolean).join("/")}`;
  }

  const raw = stringValue(url["raw"]);
  return raw ? pathFromUrl(raw) : undefined;
}

function pathFromUrl(value: string): string {
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) {
    const withoutVariables = value.replace(/\{\{[^}]+\}\}/g, "placeholder.local");
    try {
      return normalizePath(new URL(withoutVariables).pathname);
    } catch {
      // Fall through to best-effort path parsing below.
    }
  }

  const [withoutQuery = ""] = value.split("?");
  const withoutProtocol = withoutQuery.replace(/^[a-z][a-z\d+\-.]*:\/\/[^/]+/i, "");
  const withoutVariableHost = withoutProtocol.replace(/^\{\{[^}]+\}\}/, "");
  return normalizePath(withoutVariableHost);
}

function normalizePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized.split("/").map(normalizePathSegment).join("/") || "/";
}

function normalizePathSegment(segment: string): string {
  if (segment.startsWith(":") && segment.length > 1) return `{${segment.slice(1)}}`;
  return segment;
}

function postmanDescription(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  const object = asObject(value);
  return object ? stringValue(object["content"]) : undefined;
}

function postmanRequestBodySchema(request: JsonObject): JsonSchema | undefined {
  const body = asObject(request["body"]);
  if (!body) return undefined;

  const mode = stringValue(body["mode"]);
  if (mode === "raw") {
    return schemaFromJsonText(stringValue(body["raw"]));
  }

  if (mode === "urlencoded" || mode === "formdata") {
    const entries = arrayAt(body, mode);
    if (!entries?.length) return undefined;
    return schemaFromKeyValueEntries(entries);
  }

  return undefined;
}

function postmanResponseSchema(item: JsonObject): JsonSchema | undefined {
  const responses = arrayAt(item, "response");
  if (!responses) return undefined;

  const response = responses
    .map(asObject)
    .find((candidate) => {
      const code = typeof candidate?.["code"] === "number" ? candidate["code"] : undefined;
      return code !== undefined && code >= 200 && code < 300;
    }) ?? asObject(responses[0]);

  return schemaFromJsonText(stringValue(response?.["body"]));
}

function schemaFromJsonText(value: string | undefined): JsonSchema | undefined {
  if (!value?.trim()) return undefined;
  try {
    return inferJsonSchema(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function schemaFromKeyValueEntries(entries: unknown[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const entryValue of entries) {
    const entry = asObject(entryValue);
    const key = stringValue(entry?.["key"]);
    if (!key) continue;
    properties[key] = { type: "string" };
    if (!entry?.["disabled"]) required.push(key);
  }

  return omitUndefined({
    type: "object",
    properties,
    required: required.length ? required : undefined,
  });
}

function inferJsonSchema(value: unknown): JsonSchema {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    const firstItem = value.find((item) => item !== null);
    return omitUndefined({
      type: "array",
      items: firstItem === undefined ? undefined : inferJsonSchema(firstItem),
    });
  }
  if (typeof value === "object") {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, item] of Object.entries(value as JsonObject)) {
      properties[key] = inferJsonSchema(item);
      required.push(key);
    }
    return omitUndefined({
      type: "object",
      properties,
      required: required.length ? required : undefined,
    });
  }
  if (typeof value === "string") return { type: "string" };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return {};
}

function resolveRef(document: JsonObject, value: unknown, seen = new Set<string>()): unknown {
  const object = asObject(value);
  const ref = stringValue(object?.["$ref"]);
  if (!ref) return value;
  if (!ref.startsWith("#/") || seen.has(ref)) return value;

  seen.add(ref);
  const resolved = ref.slice(2).split("/").reduce<unknown>((current, segment) => {
    const currentObject = asObject(current);
    return currentObject?.[decodeJsonPointer(segment)];
  }, document);

  return resolveRef(document, resolved, seen);
}

function decodeJsonPointer(value: string): string {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function parseInput(input: string | JsonObject, label: string): JsonObject {
  if (typeof input !== "string") return input;
  try {
    const parsed = JSON.parse(input);
    const object = asObject(parsed);
    if (object) return object;
  } catch (error) {
    throw new Error(`${label} input must be a JSON object or JSON string: ${(error as Error).message}`);
  }
  throw new Error(`${label} input must be a JSON object or JSON string.`);
}

function normalizeMethod(value: string): HttpMethod | undefined {
  const method = value.toUpperCase() as HttpMethod;
  return HTTP_METHODS.has(method) ? method : undefined;
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function objectAt(value: JsonObject, key: string): JsonObject | undefined {
  return asObject(value[key]);
}

function arrayAt(value: JsonObject, key: string): unknown[] | undefined {
  const item = value[key];
  return Array.isArray(item) ? item : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length ? strings : undefined;
}

function asSchema(value: unknown): JsonSchema | undefined {
  const schema = asObject(value);
  return schema ? schema as JsonSchema : undefined;
}

function omitUndefined<T extends JsonObject>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
