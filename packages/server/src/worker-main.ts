import { loadConfig } from "./config.js";
import { wireQueue } from "./generation.js";
import { buildRuntime, installShutdown, safeClose } from "./runtime.js";

const config = loadConfig();

// worker-main is the bullmq consumer; the inprocess driver runs jobs in the API process instead.
if (config.queueDriver !== "bullmq") {
  console.error("worker-main requires QUEUE_DRIVER=bullmq");
  process.exit(1);
}

const { deps, queue, bus } = await buildRuntime(config, "worker");

// Construct the BullMQ Worker — only the worker process calls start, never the API process.
// wireQueue is the single binding of processor → queue, shared with the in-process path.
wireQueue(deps);

installShutdown(async () => {
  await safeClose(() => queue.close());
  await safeClose(() => bus.close());
});

console.log("allure-station worker consuming 'generate' jobs");
