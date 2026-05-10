import express, { type NextFunction, type Request, type Response } from "express";
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

const app = express();
app.use(express.json());

async function requirePremanToken(req: Request, res: Response, next: NextFunction) {
  if (!readBearerToken(req.headers)) {
    res.status(401).json({ error: "missing_bearer_token" });
    return;
  }

  try {
    res.locals.premanAuth = await verifyBearerToken(req.headers, auth);
    next();
  } catch (error) {
    if (error instanceof PremanAuthError) {
      res.status(401).json({ error: "invalid_bearer_token" });
      return;
    }
    if (error instanceof PremanPolicyDeniedError) {
      res.status(403).json({ error: "insufficient_scope", requiredScope: auth.requiredScope });
      return;
    }
    next(error);
  }
}

app.get("/orders", requirePremanToken, async (_req, res) => {
  res.json({
    data: [{ id: "ord_123", total: 4200 }],
    auth: res.locals.premanAuth,
  });
});

app.listen(3000);
