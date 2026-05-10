import { PremanAuthError, PremanPolicyDeniedError } from "./errors.js";
import { PremanClient } from "./client.js";
import type { VerifyTokenIdentity } from "./types.js";

export type HeaderLike = Headers | Record<string, string | string[] | undefined>;

export type RequireScopeOptions = {
  client: PremanClient;
  mcpId: string;
  requiredScope: string;
};

export async function verifyBearerToken(
  headers: HeaderLike,
  options: RequireScopeOptions,
): Promise<{
  identity: VerifyTokenIdentity;
  tokenId?: string;
  agentId?: string;
  customerId?: string;
  scopes: string[];
}> {
  if (typeof options.mcpId !== "string" || !options.mcpId.trim()) {
    throw new PremanAuthError("mcpId is required to verify a Bearer token.");
  }

  const token = readBearerToken(headers);
  if (!token) {
    throw new PremanAuthError("Missing Authorization Bearer token.");
  }

  const result = await options.client.verifyToken({
    token,
    mcpId: options.mcpId,
    requiredScope: options.requiredScope,
  });

  if (!result.valid) {
    throw new PremanPolicyDeniedError(`Token is not valid for scope ${options.requiredScope}.`);
  }

  const identity = result.identity ?? {};
  return omitUndefined({
    identity,
    tokenId: identity.tokenId ?? result.tokenId,
    agentId: identity.agentId ?? result.agentId,
    customerId: identity.customerId ?? result.customerId,
    scopes: result.scopes,
  });
}

export function readBearerToken(headers: HeaderLike): string | null {
  const authorization =
    headers instanceof Headers
      ? headers.get("authorization")
      : headers["authorization"] ?? headers["Authorization"];
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
