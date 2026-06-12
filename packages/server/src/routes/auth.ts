import type { FastifyInstance, FastifyReply } from "fastify";
import { loginRequestSchema, type SessionUser } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authenticate, generateSessionToken, hashSessionToken, SESSION_COOKIE } from "../auth.js";
import { actorFromPrincipal, recordAudit } from "../audit.js";
import { hashPassword, verifyPassword } from "../password.js";
import { resolveOidcUser } from "../oidc.js";

const OIDC_COOKIE = "as_oidc";
const OIDC_COOKIE_PATH = "/api/auth/oidc";

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

/** Create a DB-backed session for a user and set the session cookie. Shared by local + OIDC login. */
async function startSession(reply: FastifyReply, deps: AppDeps, userId: string): Promise<void> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.parse(deps.now()) + deps.sessionTtlMs).toISOString();
  await deps.sessions.create(hashSessionToken(token), userId, deps.now(), expiresAt, {});
  void deps.sessions.deleteExpired(deps.now()).catch(() => {}); // opportunistic, best-effort
  setSessionCookie(reply, deps, token);
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
    await startSession(reply, deps, user.id);
    await recordAudit(deps, { actorType: "user", actorId: user.id, actorLabel: user.email, action: "login", targetType: "user", targetId: user.id, metadata: { via: "local" } });
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

  // --- OIDC / SSO (Phase 5d) — registered only when a provider is configured ---
  if (deps.oidc && deps.oidcConfig) {
    const provider = deps.oidc;
    const oidcConfig = deps.oidcConfig;

    app.get("/auth/oidc/login", async (_req, reply) => {
      let start;
      try {
        start = await provider.startLogin();
      } catch {
        // IdP unreachable / discovery failed — don't 500, send the user back with an error.
        return reply.redirect("/login?error=sso");
      }
      // Short-lived cookie carries the CSRF state, nonce, and PKCE verifier across the IdP round-trip.
      // sameSite=lax so it survives the top-level GET redirect back to the callback.
      reply.setCookie(OIDC_COOKIE, JSON.stringify({ state: start.state, nonce: start.nonce, codeVerifier: start.codeVerifier }), {
        httpOnly: true,
        sameSite: "lax",
        secure: deps.cookieSecure,
        path: OIDC_COOKIE_PATH,
        maxAge: 600,
      });
      return reply.redirect(start.url);
    });

    app.get("/auth/oidc/callback", async (req, reply) => {
      const raw = req.cookies?.[OIDC_COOKIE];
      reply.clearCookie(OIDC_COOKIE, { path: OIDC_COOKIE_PATH });
      // Record abnormal callbacks (state mismatch / replay / IdP error) so SSO abuse leaves a trail.
      const fail = async (reason: string) => {
        await recordAudit(deps, { actorType: "anonymous", actorId: null, actorLabel: "anonymous", action: "login_failed", metadata: { via: "oidc", reason } });
        return reply.redirect("/login?error=sso");
      };
      if (!raw) return fail("missing_state");
      try {
        const flow = JSON.parse(raw) as { state: string; nonce: string; codeVerifier: string };
        const claims = await provider.completeLogin({ query: req.query as Record<string, unknown>, state: flow.state, nonce: flow.nonce, codeVerifier: flow.codeVerifier });
        const resolved = await resolveOidcUser(deps, claims, oidcConfig);
        if ("error" in resolved) return fail(resolved.error);
        await startSession(reply, deps, resolved.userId);
        if (resolved.provisioned) {
          await recordAudit(deps, { actorType: "user", actorId: resolved.userId, actorLabel: resolved.email, action: "user_created", targetType: "user", targetId: resolved.userId, metadata: { via: "oidc" } });
        }
        await recordAudit(deps, { actorType: "user", actorId: resolved.userId, actorLabel: resolved.email, action: "login", targetType: "user", targetId: resolved.userId, metadata: { via: "oidc" } });
        return reply.redirect("/");
      } catch {
        return fail("exchange_error"); // bad code / state mismatch / token error / DB error
      }
    });
  }
}
