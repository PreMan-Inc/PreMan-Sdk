import assert from "node:assert/strict";
import test from "node:test";

import { getGithubActiveRuntimeCommits } from "../dist/index.js";

test("getGithubActiveRuntimeCommits reports and ranks commits serving traffic", () => {
  const first = "a".repeat(40);
  const second = "b".repeat(40);
  const result = getGithubActiveRuntimeCommits({
    runtime_results: [
      { build_attestation: { status: "mismatch", verified: false, reported_commit_sha: second } },
      { build_attestation: { status: "verified", verified: true, reported_commit_sha: "c".repeat(40) } },
      { build_attestation: { status: "mismatch", verified: false, reported_commit_sha: first } },
      { build_attestation: { status: "mismatch", verified: false, reported_commit_sha: first } },
      { build_attestation: { status: "mismatch", verified: false, reported_commit_sha: "short" } },
    ],
  });

  assert.deepEqual(result, [
    { commitSha: first, responseCount: 2 },
    { commitSha: second, responseCount: 1 },
  ]);
});
