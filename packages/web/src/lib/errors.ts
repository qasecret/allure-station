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
    const parsed = JSON.parse(raw) as { error?: unknown };
    return typeof parsed?.error === "string" ? parsed.error : "";
  } catch {
    return raw;
  }
}

/** True for short prose the server wrote for humans (zod/validation messages qualify). */
function readsLikeSentence(s: string): boolean {
  const t = s.trimStart();
  return s.length > 0 && s.length < 200 && !t.startsWith("{") && !t.startsWith("<") && !t.startsWith("[");
}

/** Map any thrown value to a human sentence with a recovery hint. Never returns raw "409: …". */
export function humanizeError(e: unknown, context?: keyof typeof CONFLICTS | string): string {
  if (!(e instanceof ApiError)) return "Something went wrong — try again.";
  const { status } = e;
  if (status === 0) return "Can't reach the server — check your connection and try again.";
  if (status === 401) return "Your session has expired — sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "That no longer exists — it may have been deleted.";
  if (status === 409) return (context && CONFLICTS[context]) || "That conflicts with something that already exists.";
  if (status === 413) return "That upload is too large.";
  if (status === 400 || status === 422) {
    const text = serverText(e.serverMessage);
    return readsLikeSentence(text) ? text : "That request wasn't valid — check the form and try again.";
  }
  if (status >= 500) return "Something went wrong on the server — try again in a moment.";
  const text = serverText(e.serverMessage);
  return readsLikeSentence(text) ? text : "Something went wrong — try again.";
}
