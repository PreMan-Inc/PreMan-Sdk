import { PremanClient } from "preman-sdk";

const endpointId = process.env.PREMAN_ENDPOINT_ID;
if (!endpointId) {
  throw new Error("Set PREMAN_ENDPOINT_ID to an endpoint saved in your PreMan workspace.");
}

const preman = new PremanClient();

const probe = await preman.configureEndpointProbe({
  endpointId,
  intervalSeconds: 60,
  timeoutSeconds: 10,
  expectedStatus: 200,
  unattendedPolicy: "read_only",
});

const healingRule = await preman.createHealingRule({
  name: "Repair auth after repeated failures",
  targetId: endpointId,
  thresholdFailures: 3,
  autofixEnabled: true,
});

console.log({ probe, healingRule });

// Later, inspect the repair queue or explicitly retry a failed native repair.
const [fixTask] = await preman.listFixTasks({ status: "open", limit: 1 });
if (fixTask && fixTask.dispatchStage === "failed") {
  await preman.startSelfHealing({ fixTaskId: fixTask.id });
  const completed = await preman.waitForSelfHealing({ fixTaskId: fixTask.id });
  console.log({ pullRequest: completed.prUrl, validation: completed.dispatchResult });
}
