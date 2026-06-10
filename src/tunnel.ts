import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { PremanClient } from "./client.js";
import type { CreateLocalStdioTunnelRequest, LocalStdioTunnelResponse, RequestOptions } from "./types.js";

export type RunLocalStdioTunnelOptions = CreateLocalStdioTunnelRequest & {
  env?: Record<string, string | undefined>;
  pollWaitMs?: number;
  request?: RequestOptions;
  onEvent?: (event: LocalStdioTunnelEvent) => void;
};

export type LocalStdioTunnelEvent =
  | { type: "registered"; tunnel: LocalStdioTunnelResponse }
  | { type: "started"; pid?: number }
  | { type: "stderr"; line: string }
  | { type: "message"; direction: "local-to-remote" | "remote-to-local"; message: Record<string, unknown> }
  | { type: "error"; error: unknown }
  | { type: "closed"; code: number | null; signal: NodeJS.Signals | null };

export async function runLocalStdioTunnel(
  client: PremanClient,
  options: RunLocalStdioTunnelOptions,
): Promise<LocalStdioTunnelResponse> {
  const tunnel = await client.createLocalStdioTunnel(options);
  options.onEvent?.({ type: "registered", tunnel });

  const child = spawnLocalMcp(options);
  options.onEvent?.({ type: "started", pid: child.pid });
  await client.updateLocalStdioTunnelStatus({ tunnelId: tunnel.tunnelId, status: "connected" });

  const stop = new AbortController();
  const stdoutDone = forwardLocalStdout(client, tunnel.tunnelId, child, options, stop.signal);
  const stderrDone = forwardLocalStderr(child, options);
  const pollDone = forwardRemoteMessages(client, tunnel.tunnelId, child, options, stop.signal);

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  }).finally(() => stop.abort());

  const [code, signal] = [child.exitCode, child.signalCode];
  options.onEvent?.({ type: "closed", code, signal });
  await client.updateLocalStdioTunnelStatus({
    tunnelId: tunnel.tunnelId,
    status: code === 0 ? "closed" : "error",
    detail: code === 0 ? undefined : `Local STDIO MCP exited with code ${code ?? "unknown"}${signal ? ` and signal ${signal}` : ""}.`,
  }).catch((error) => options.onEvent?.({ type: "error", error }));

  await Promise.allSettled([stdoutDone, stderrDone, pollDone]);
  return tunnel;
}

function spawnLocalMcp(options: RunLocalStdioTunnelOptions): ChildProcessWithoutNullStreams {
  return spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function forwardLocalStdout(
  client: PremanClient,
  tunnelId: string,
  child: ChildProcessWithoutNullStreams,
  options: RunLocalStdioTunnelOptions,
  signal: AbortSignal,
): Promise<void> {
  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    if (signal.aborted) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const message = JSON.parse(trimmed) as Record<string, unknown>;
      options.onEvent?.({ type: "message", direction: "local-to-remote", message });
      await client.sendLocalStdioTunnelMessage({ tunnelId, message });
    } catch (error) {
      options.onEvent?.({ type: "error", error });
      await client.updateLocalStdioTunnelStatus({
        tunnelId,
        status: "error",
        detail: `Local STDIO MCP emitted invalid JSON-RPC: ${trimmed.slice(0, 500)}`,
      }).catch((statusError) => options.onEvent?.({ type: "error", error: statusError }));
    }
  }
}

async function forwardLocalStderr(
  child: ChildProcessWithoutNullStreams,
  options: RunLocalStdioTunnelOptions,
): Promise<void> {
  const lines = createInterface({ input: child.stderr });
  for await (const line of lines) {
    options.onEvent?.({ type: "stderr", line });
  }
}

async function forwardRemoteMessages(
  client: PremanClient,
  tunnelId: string,
  child: ChildProcessWithoutNullStreams,
  options: RunLocalStdioTunnelOptions,
  signal: AbortSignal,
): Promise<void> {
  const waitMs = options.pollWaitMs ?? 30_000;
  while (!signal.aborted && !child.killed) {
    try {
      const polled = await client.pollLocalStdioTunnelMessages({
        tunnelId,
        waitMs,
        request: { timeoutMs: waitMs + 5_000, retry: { retries: 0 } },
      });
      for (const item of polled.messages) {
        if (signal.aborted) return;
        options.onEvent?.({ type: "message", direction: "remote-to-local", message: item.message });
        child.stdin.write(`${JSON.stringify(item.message)}\n`);
      }
    } catch (error) {
      if (signal.aborted) return;
      options.onEvent?.({ type: "error", error });
      await sleep(1_000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
