# PreMan SDK Examples

- `basic.ts` deploys a hosted MCP server and creates a scoped consumer token.
- `frameworks/express.ts` protects an Express route with a PreMan bearer token.
- `frameworks/fastify.ts` protects a Fastify route with a PreMan bearer token.
- `frameworks/next-route-handler.ts` protects a Next.js App Router route handler.
- `frameworks/hono.ts` protects a Hono route with a PreMan bearer token.

Each framework example initializes `PremanClient`, checks the `Authorization: Bearer ...` header with `readBearerToken`, verifies it with `verifyBearerToken`, and returns `401` for missing or invalid tokens and `403` for valid tokens missing the required scope.
