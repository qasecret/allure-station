import { describe, it, expect } from "vitest";
import { ApiError, humanizeError } from "./errors";

describe("humanizeError", () => {
  // For 409 we use JSON-garbage so the generic fallback is exercised (plain text prose is returned as-is per item 1).
  const cases: Array<[number, string, string | RegExp]> = [
    [0, "raw server text", /can't reach the server/i],
    [401, "unauthenticated", /session has expired/i],
    [403, "forbidden", /don't have permission/i],
    [404, "raw server text", /no longer exists/i],
    [409, '{"x":1}', /conflicts with something/i],
    [413, "raw server text", /too large/i],
    [500, "raw server text", /went wrong on the server/i],
    [502, "raw server text", /went wrong on the server/i],
    [503, "raw server text", /went wrong on the server/i],
  ];
  it.each(cases)("maps status %i", (status, body, expected) => {
    const msg = humanizeError(new ApiError(status, body));
    expect(msg).toMatch(expected);
    expect(msg).not.toMatch(/^\d/); // never leads with a bare status code
  });
  it("409 uses context when given", () => {
    expect(humanizeError(new ApiError(409, "exists"), "user")).toBe("That email is already in use.");
    expect(humanizeError(new ApiError(409, "exists"), "project")).toBe("A project with that id already exists.");
    expect(humanizeError(new ApiError(409, "exists"), "token")).toBe("A token with that name already exists.");
  });
  it("400/422 prefers a sentence-like server message", () => {
    expect(humanizeError(new ApiError(400, 'invalid sort "bogus"'))).toBe('invalid sort "bogus"');
    expect(humanizeError(new ApiError(422, "{}"))).toMatch(/wasn't valid/i); // JSON-ish → generic
    expect(humanizeError(new ApiError(400, ""))).toMatch(/wasn't valid/i);
    expect(humanizeError(new ApiError(400, '[{"code":"too_small"}]'))).toMatch(/wasn't valid/i); // zod issue arrays → generic (old behaviour, now overridden by item 3)
  });
  it("unwraps {error} JSON envelopes from the body", () => {
    expect(humanizeError(new ApiError(400, '{"error":"branch name too long"}'))).toBe("branch name too long");
  });
  it("non-ApiError unknowns get the generic fallback, never undefined", () => {
    expect(humanizeError(new Error("boom"))).toMatch(/something went wrong/i);
    expect(humanizeError(undefined)).toMatch(/something went wrong/i);
    expect(humanizeError({ weird: true })).toMatch(/something went wrong/i);
  });

  // --- item 1: 409 state-conflict server prose ---
  it("409 with actionable prose from the server uses that text when no context matches", () => {
    expect(humanizeError(new ApiError(409, "run is generating; wait or let the reconciler fail it first"))).toBe(
      "run is generating; wait or let the reconciler fail it first",
    );
  });
  it("409 with JSON-garbage body falls back to the generic uniqueness copy", () => {
    expect(humanizeError(new ApiError(409, '{"x":1}'))).toMatch(/conflicts with something/i);
  });
  it("409 context key always wins over serverMessage prose", () => {
    expect(humanizeError(new ApiError(409, "run is generating; wait or let the reconciler fail it first"), "user")).toBe(
      "That email is already in use.",
    );
  });

  // --- 401 always means session-expired (server now disambiguates via 403 for role failures) ---
  it("401 always shows session-expired copy regardless of body", () => {
    expect(humanizeError(new ApiError(401, "unauthenticated"))).toMatch(/session has expired/i);
    expect(humanizeError(new ApiError(401, "token expired"))).toMatch(/session has expired/i);
    expect(humanizeError(new ApiError(401, ""))).toMatch(/session has expired/i);
  });
  it("403 shows permission-denied copy with owner-access hint", () => {
    expect(humanizeError(new ApiError(403, "forbidden"))).toMatch(/don't have permission/i);
    expect(humanizeError(new ApiError(403, "forbidden"))).toMatch(/ask an owner/i);
  });

  // --- item 3: zod 400 arrays produce a field hint ---
  it("400 with a zod issues array extracts field and message from the first issue", () => {
    const zodBody = JSON.stringify([{ code: "too_small", path: ["password"], message: "String must contain at least 8 character(s)" }]);
    expect(humanizeError(new ApiError(400, zodBody))).toBe("password: String must contain at least 8 character(s)");
  });
  it("400 with a zod issues array with no path shows message only", () => {
    const zodBody = JSON.stringify([{ code: "custom", path: [], message: "At least one field is required" }]);
    expect(humanizeError(new ApiError(400, zodBody))).toBe("At least one field is required");
  });
  it("400 with a zod issues array with no message falls back to the generic copy", () => {
    const zodBody = JSON.stringify([{ code: "too_small", path: ["x"] }]);
    expect(humanizeError(new ApiError(400, zodBody))).toMatch(/wasn't valid/i);
  });

  // --- item 4: whitespace-only body treated as non-sentence → generic ---
  it("400 with a whitespace-only body returns the generic copy", () => {
    expect(humanizeError(new ApiError(400, "\n"))).toMatch(/wasn't valid/i);
    expect(humanizeError(new ApiError(400, "   "))).toMatch(/wasn't valid/i);
  });
});
