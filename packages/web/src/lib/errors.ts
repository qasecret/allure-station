/** Structured API failure thrown by api/client.ts. status 0 = network failure (fetch rejected). */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly serverMessage: string) {
    super(`${status}: ${serverMessage}`);
    this.name = "ApiError";
  }
}

const CONFLICTS: Record<string, string> = {
  user: "That email is already in use.",
  project: "A project with that id already exists.",
  token: "A token with that name already exists.",
};

/** Server bodies may be plain text or a JSON {error} envelope — extract the human part. */
function serverText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    // Zod issue arrays: [{code, message, path, …}, …]
    if (Array.isArray(parsed)) {
      const first = (parsed as Array<{ code?: unknown; message?: unknown; path?: unknown[] }>)[0];
      if (!first?.message) return "";
      const msg = String(first.message);
      const path = Array.isArray(first.path) && first.path.length > 0
        ? first.path.map(String).join(".")
        : null;
      return path ? `${path}: ${msg}` : msg;
    }
    const obj = parsed as { error?: unknown };
    return typeof obj?.error === "string" ? obj.error : "";
  } catch {
    return raw;
  }
}

/** True for short prose the server wrote for humans (zod/validation messages qualify). */
function readsLikeSentence(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && t.length < 200 && !t.startsWith("{") && !t.startsWith("<") && !t.startsWith("[");
}

/** Map any thrown value to a human sentence with a recovery hint. Never returns raw "409: …". */
export function humanizeError(e: unknown, context?: keyof typeof CONFLICTS | string): string {
  if (!(e instanceof ApiError)) return "Something went wrong — try again.";
  const { status } = e;
  if (status === 0) return "Can't reach the server — check your connection and try again.";
  if (status === 401) {
    // The server sends the same 401 {error:"unauthorized"} for an expired/missing session AND
    // for a signed-in user below the required role — it cannot be disambiguated client-side
    // (see docs/FUTURE-WORK.md: 401/403 split), so the copy must offer both remedies honestly.
    if (serverText(e.serverMessage).toLowerCase() === "unauthorized")
      return "You're not authorized to do that — sign in again, or ask an owner for write access.";
    return "Your session has expired — sign in again.";
  }
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "That no longer exists — it may have been deleted.";
  if (status === 409) {
    if (context && CONFLICTS[context]) return CONFLICTS[context];
    const text = serverText(e.serverMessage);
    return readsLikeSentence(text) ? text : "That conflicts with something that already exists.";
  }
  if (status === 413) return "That upload is too large.";
  if (status === 400 || status === 422) {
    const text = serverText(e.serverMessage);
    return readsLikeSentence(text) ? text : "That request wasn't valid — check the form and try again.";
  }
  if (status >= 500) return "Something went wrong on the server — try again in a moment.";
  const text = serverText(e.serverMessage);
  return readsLikeSentence(text) ? text : "Something went wrong — try again.";
}
