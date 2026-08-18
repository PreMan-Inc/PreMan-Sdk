import type { GithubSimulationSummary } from "./types.js";

export type GithubActiveRuntimeCommit = {
  commitSha: string;
  responseCount: number;
};

/**
 * Return the non-candidate commits attested by runtime responses, ordered by
 * response count. A result can contain more than one commit during a rolling
 * or split deployment, so callers should not assume the first entry is alone.
 */
export function getGithubActiveRuntimeCommits(
  summary: GithubSimulationSummary,
): GithubActiveRuntimeCommit[] {
  const counts = new Map<string, number>();
  for (const result of summary.runtime_results ?? []) {
    const attestation = result.build_attestation;
    if (String(attestation?.status || "").toLowerCase() !== "mismatch") continue;
    const commitSha = String(attestation?.reported_commit_sha || "").trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(commitSha)) continue;
    counts.set(commitSha, (counts.get(commitSha) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([commitSha, responseCount]) => ({ commitSha, responseCount }))
    .sort((left, right) =>
      right.responseCount - left.responseCount || left.commitSha.localeCompare(right.commitSha)
    );
}
