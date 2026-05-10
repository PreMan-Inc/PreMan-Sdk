import { Hono, type Context, type Next } from "hono";
import {
  PremanAuthError,
  PremanClient,
  PremanPolicyDeniedError,
  readBearerToken,
  verifyBearerToken,
} from "preman-sdk";

type Variables = {
  premanAuth: Awaited<ReturnType<typeof verifyBearerToken>>;
};

const preman = new PremanClient({
  apiKey: process.env.PREMAN_API_KEY,
});

const auth = {
  client: preman,
  mcpId: process.env.PREMAN_MCP_ID ?? "mcp_123",
  requiredScope: "orders:read",
};

const app = new Hono<{ Variables: Variables }>();

async function requirePremanToken(c: Context<{ Variables: Variables }>, next: Next) {
  if (!readBearerToken(c.req.raw.headers)) {
    return c.json({ error: "missing_bearer_token" }, 401);
  }

  try {
    c.set("premanAuth", await verifyBearerToken(c.req.raw.headers, auth));
  } catch (error) {
    if (error instanceof PremanAuthError) {
      return c.json({ error: "invalid_bearer_token" }, 401);
    }
    if (error instanceof PremanPolicyDeniedError) {
      return c.json({ error: "insufficient_scope", requiredScope: auth.requiredScope }, 403);
    }
    throw error;
  }

  await next();
}

app.get("/orders", requirePremanToken, (c) => c.json({
  data: [{ id: "ord_123", total: 4200 }],
  auth: c.get("premanAuth"),
}));

export default app;
