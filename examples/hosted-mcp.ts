import { PremanClient } from "preman-sdk";

const preman = new PremanClient();

const deployed = await preman.deployMcp({
  name: "Auth MCP",
  upstreamBaseUrl: "https://api.example.com",
  endpoints: [
    {
      method: "POST",
      path: "/auth/login",
      scope: "auth:login",
      description: "Login with email and password.",
    },
  ],
});

const token = await preman.createToken({
  mcpId: deployed.mcpId,
  agentId: "cursor-agent",
  scopes: ["auth:login"],
  ttlSeconds: 900,
});

console.log(token.installSnippet.mcpJsonString);
