import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { wireQueue } from "./generation.js";
import { buildRuntime, installShutdown, safeClose } from "./runtime.js";

const config = loadConfig();
const { deps, queue, bus, stopReconciler } = await buildRuntime(config);

const app = buildApp(deps);

// Wire the processor only for the in-process driver.
// In bullmq mode the API process must NOT construct a Worker — only worker-main does.
if (config.queueDriver === "inprocess") {
  wireQueue(deps);
}

installShutdown(async () => {
  stopReconciler();
  // Stop accepting new requests FIRST, then drain background jobs, then close the bus — otherwise a
  // /generate arriving mid-shutdown would hit an already-closed queue, get markFailed'd, and 503.
  await safeClose(() => app.close());
  await safeClose(() => queue.close());
  await safeClose(() => bus.close());
});

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => console.log(`allure-station listening on :${config.port}`))
  .catch((err) => { console.error(err); process.exit(1); });
