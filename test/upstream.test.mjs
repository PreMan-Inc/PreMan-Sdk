import assert from "node:assert/strict";
import test from "node:test";
import { isLocalUpstreamUrl, localUpstreamMessage } from "../dist/index.js";

test("isLocalUpstreamUrl detects local and private upstreams", () => {
  assert.equal(isLocalUpstreamUrl("http://localhost:8000"), true);
  assert.equal(isLocalUpstreamUrl("http://127.0.0.1:8000"), true);
  assert.equal(isLocalUpstreamUrl("http://127.3.4.5:8000"), true);
  assert.equal(isLocalUpstreamUrl("http://10.0.0.5"), true);
  assert.equal(isLocalUpstreamUrl("http://172.16.0.5"), true);
  assert.equal(isLocalUpstreamUrl("http://172.31.0.5"), true);
  assert.equal(isLocalUpstreamUrl("http://192.168.1.20"), true);
  assert.equal(isLocalUpstreamUrl("https://api.company.com"), false);
  assert.equal(isLocalUpstreamUrl("https://flow.opentest.live"), false);
});

test("localUpstreamMessage points users to tunnels", () => {
  const message = localUpstreamMessage("http://localhost:8000");
  assert.match(message, /Hosted MCPs cannot reach/);
  assert.match(message, /ngrok/);
  assert.match(message, /Cloudflare Tunnel/);
});
