import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

export function registerEventRoutes(app: FastifyInstance, deps: AppDeps): void {
  // SSE stream of run lifecycle events for one project. Clients reconnect automatically (EventSource).
  app.get("/projects/:projectId/events", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });

    reply.hijack(); // we own the socket from here; Fastify will not send a response
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable proxy buffering (nginx)
    });
    res.write("retry: 3000\n\n");

    const unsub = deps.bus.subscribe((event) => {
      if (event.projectId !== projectId) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      unsub();
    };
    req.raw.on("close", cleanup);
    req.raw.on("error", cleanup);
  });
}
