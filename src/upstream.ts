export function isLocalUpstreamUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.endsWith(".localhost")
    || hostname.startsWith("127.")
    || hostname.startsWith("10.")
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    || hostname.startsWith("192.168.")
  );
}

export function localUpstreamMessage(upstream: string): string {
  return [
    `Hosted MCPs cannot reach local/private upstream URLs like ${upstream}.`,
    "Use a deployed staging API or expose your local server with a tunnel such as ngrok or Cloudflare Tunnel.",
    "Pass --allow-local only if you are intentionally creating a local-only preview.",
  ].join(" ");
}
