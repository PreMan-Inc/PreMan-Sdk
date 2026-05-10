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

export async function GET(request: Request) {
  if (!readBearerToken(request.headers)) {
    return Response.json({ error: "missing_bearer_token" }, { status: 401 });
  }

  try {
    const premanAuth = await verifyBearerToken(request.headers, auth);

    return Response.json({
      data: [{ id: "ord_123", total: 4200 }],
      auth: premanAuth,
    });
  } catch (error) {
    if (error instanceof PremanAuthError) {
      return Response.json({ error: "invalid_bearer_token" }, { status: 401 });
    }
    if (error instanceof PremanPolicyDeniedError) {
      return Response.json(
        { error: "insufficient_scope", requiredScope: auth.requiredScope },
        { status: 403 },
      );
    }
    throw error;
  }
}
