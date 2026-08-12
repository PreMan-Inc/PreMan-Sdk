# PreMan SDK Examples

- `basic.ts` configures continuous endpoint testing and an autofix-enabled failure rule.
- `self-healing.ts` follows the same flow and shows how to retry and await a failed repair.
- `hosted-mcp.ts` deploys a hosted MCP server and creates a scoped consumer token.
- `frameworks/express.ts` protects an Express route with a PreMan bearer token.
- `frameworks/fastify.ts` protects a Fastify route with a PreMan bearer token.
- `frameworks/next-route-handler.ts` protects a Next.js App Router route handler.
- `frameworks/hono.ts` protects a Hono route with a PreMan bearer token.

The framework examples cover the secondary hosted-MCP security surface. Each initializes `PremanClient`, checks the `Authorization: Bearer ...` header with `readBearerToken`, verifies it with `verifyBearerToken`, and returns `401` for missing or invalid tokens and `403` for valid tokens missing the required scope.
