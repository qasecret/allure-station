import type { FastifyInstance, FastifyReply } from "fastify";
import { loginRequestSchema, type SessionUser } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authenticate, generateSessionToken, hashSessionToken, SESSION_COOKIE } from "../auth.js";
import { verifyPassword } from "../password.js";

function setSessionCookie(reply: FastifyReply, deps: AppDeps, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: deps.cookieSecure,
    path: "/",
    maxAge: Math.floor(deps.sessionTtlMs / 1000),
  });
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/auth/login", async (req, reply) => {
    const parsed = loginRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const user = await deps.users.findByEmail(parsed.data.email);
    // Generic 401 on either bad email or bad password — don't reveal which emails exist.
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    const token = generateSessionToken();
    const expiresAt = new Date(Date.parse(deps.now()) + deps.sessionTtlMs).toISOString();
    await deps.sessions.create(hashSessionToken(token), user.id, deps.now(), expiresAt);
    setSessionCookie(reply, deps, token);
    const body: SessionUser = { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt };
    return reply.code(200).send(body);
  });

  app.post("/auth/logout", async (req, reply) => {
    const cookie = req.cookies?.[SESSION_COOKIE];
    if (cookie) await deps.sessions.removeByHash(hashSessionToken(cookie));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/auth/me", async (req, reply) => {
    const principal = await authenticate(deps, req);
    if (principal.kind !== "user") return reply.code(200).send(null);
    const body: SessionUser = {
      id: principal.userId,
      email: principal.email,
      role: principal.role,
      createdAt: principal.createdAt,
    };
    return reply.code(200).send(body);
  });
}
