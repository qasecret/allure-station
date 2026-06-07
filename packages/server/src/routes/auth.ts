import type { FastifyInstance, FastifyReply } from "fastify";
import { loginRequestSchema, type SessionUser } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authenticate, generateSessionToken, hashSessionToken, SESSION_COOKIE } from "../auth.js";
import { actorFromPrincipal, recordAudit } from "../audit.js";
import { hashPassword, verifyPassword } from "../password.js";

// A throwaway hash verified against when the email is unknown, so a missing account costs the same
// scrypt work as a wrong password — closing the login timing oracle that would enumerate emails.
const dummyHash = hashPassword("timing-equalizer-not-a-real-password");

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
    // Generic 401 on either bad email or bad password — don't reveal which emails exist. Always run
    // a scrypt verify (against a dummy hash when the user is absent) so timing doesn't leak existence.
    const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await dummyHash));
    if (!user || !ok) {
      await recordAudit(deps, { actorType: "anonymous", actorId: null, actorLabel: "anonymous", action: "login_failed", metadata: { email: parsed.data.email } });
      return reply.code(401).send({ error: "invalid credentials" });
    }
    const token = generateSessionToken();
    const expiresAt = new Date(Date.parse(deps.now()) + deps.sessionTtlMs).toISOString();
    await deps.sessions.create(hashSessionToken(token), user.id, deps.now(), expiresAt);
    // Opportunistic, best-effort sweep of expired rows so the table doesn't grow unbounded.
    void deps.sessions.deleteExpired(deps.now()).catch(() => {});
    await recordAudit(deps, { actorType: "user", actorId: user.id, actorLabel: user.email, action: "login", targetType: "user", targetId: user.id });
    setSessionCookie(reply, deps, token);
    const body: SessionUser = { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt };
    return reply.code(200).send(body);
  });

  app.post("/auth/logout", async (req, reply) => {
    const principal = await authenticate(deps, req);
    const cookie = req.cookies?.[SESSION_COOKIE];
    if (cookie) await deps.sessions.removeByHash(hashSessionToken(cookie));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    if (principal.kind === "user") {
      await recordAudit(deps, { ...actorFromPrincipal(principal), action: "logout", targetType: "user", targetId: principal.userId });
    }
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
