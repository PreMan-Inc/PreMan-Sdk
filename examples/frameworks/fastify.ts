import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  PremanAuthError,
  PremanClient,
  PremanPolicyDeniedError,
  readBearerToken,
  verifyBearerToken,
} from "preman-sdk";

const preman = new PremanClient({
  apiKey: process.env.PREMAN_API_KEY,
});

const auth = {
  client: preman,
  mcpId: process.env.PREMAN_MCP_ID ?? "mcp_123",
  requiredScope: "orders:read",
};

const fastify = Fastify({ logger: true });

async function requirePremanToken(request: FastifyRequest, reply: FastifyReply) {
  if (!readBearerToken(request.headers)) {
    await reply.code(401).send({ error: "missing_bearer_token" });
    return;
  }

  try {
    request.premanAuth = await verifyBearerToken(request.headers, auth);
  } catch (error) {
    if (error instanceof PremanAuthError) {
      await reply.code(401).send({ error: "invalid_bearer_token" });
      return;
    }
    if (error instanceof PremanPolicyDeniedError) {
      await reply.code(403).send({ error: "insufficient_scope", requiredScope: auth.requiredScope });
      return;
    }
    throw error;
  }
}

fastify.decorateRequest("premanAuth");

fastify.get("/orders", { preHandler: requirePremanToken }, async (request) => ({
  data: [{ id: "ord_123", total: 4200 }],
  auth: request.premanAuth,
}));

await fastify.listen({ port: 3000 });

declare module "fastify" {
  interface FastifyRequest {
    premanAuth?: Awaited<ReturnType<typeof verifyBearerToken>>;
  }
}
