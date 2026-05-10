import assert from "node:assert/strict";
import test from "node:test";
import { fromOpenApi, fromPostmanCollection } from "../dist/importers.js";
import { fromOpenApi as fromRootOpenApi } from "../dist/index.js";

test("fromOpenApi preserves methods, paths, metadata, and JSON schemas", () => {
  const endpoints = fromOpenApi(JSON.stringify({
    openapi: "3.1.0",
    paths: {
      "/users/{id}": {
        get: {
          tags: ["Users"],
          summary: "Get user",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
        },
        post: {
          tags: ["Users"],
          description: "Create user",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { email: { type: "string" } },
                  required: ["email"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: {
          type: "object",
          properties: { id: { type: "string" } },
        },
      },
    },
  }));

  assert.deepEqual(endpoints, [
    {
      method: "GET",
      path: "/users/{id}",
      tags: ["Users"],
      description: "Get user",
      responseSchema: {
        type: "object",
        properties: { id: { type: "string" } },
      },
    },
    {
      method: "POST",
      path: "/users/{id}",
      tags: ["Users"],
      description: "Create user",
      requestBodySchema: {
        type: "object",
        properties: { email: { type: "string" } },
        required: ["email"],
      },
      responseSchema: {
        type: "object",
        properties: { id: { type: "string" } },
      },
    },
  ]);
});

test("fromOpenApi supports Swagger 2 body and response schemas", () => {
  const endpoints = fromRootOpenApi({
    swagger: "2.0",
    paths: {
      "/pets": {
        post: {
          parameters: [
            {
              in: "body",
              name: "body",
              schema: { type: "object", properties: { name: { type: "string" } } },
            },
          ],
          responses: {
            "200": {
              schema: { type: "object", properties: { ok: { type: "boolean" } } },
            },
          },
        },
      },
    },
  });

  assert.equal(endpoints[0].method, "POST");
  assert.equal(endpoints[0].path, "/pets");
  assert.deepEqual(endpoints[0].requestBodySchema, {
    type: "object",
    properties: { name: { type: "string" } },
  });
  assert.deepEqual(endpoints[0].responseSchema, {
    type: "object",
    properties: { ok: { type: "boolean" } },
  });
});

test("fromPostmanCollection walks folders and infers schemas from JSON examples", () => {
  const endpoints = fromPostmanCollection({
    info: {
      name: "Example",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [
      {
        name: "Auth",
        item: [
          {
            name: "Login",
            request: {
              method: "POST",
              description: { content: "Log in with email and password" },
              url: {
                raw: "https://api.example.com/auth/login?debug=true",
                host: ["api", "example", "com"],
                path: ["auth", "login"],
              },
              body: {
                mode: "raw",
                raw: JSON.stringify({ email: "a@example.com", password: "secret" }),
              },
            },
            response: [
              {
                code: 200,
                body: JSON.stringify({ token: "abc", expiresIn: 3600 }),
              },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(endpoints, [
    {
      method: "POST",
      path: "/auth/login",
      tags: ["Auth"],
      description: "Log in with email and password",
      requestBodySchema: {
        type: "object",
        properties: {
          email: { type: "string" },
          password: { type: "string" },
        },
        required: ["email", "password"],
      },
      responseSchema: {
        type: "object",
        properties: {
          token: { type: "string" },
          expiresIn: { type: "integer" },
        },
        required: ["token", "expiresIn"],
      },
    },
  ]);
});

test("fromPostmanCollection accepts JSON strings and converts colon path params", () => {
  const endpoints = fromPostmanCollection(JSON.stringify({
    item: [
      {
        request: {
          method: "PATCH",
          url: "{{baseUrl}}/users/:id",
          body: {
            mode: "urlencoded",
            urlencoded: [{ key: "name", value: "Ada" }],
          },
        },
      },
    ],
  }));

  assert.deepEqual(endpoints, [
    {
      method: "PATCH",
      path: "/users/{id}",
      requestBodySchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  ]);
});
