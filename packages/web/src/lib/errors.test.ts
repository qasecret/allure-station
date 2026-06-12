import { describe, it, expect } from "vitest";
import { ApiError, humanizeError } from "./errors";

describe("humanizeError", () => {
  const cases: Array<[number, string | RegExp]> = [
    [0, /can't reach the server/i],
    [401, /session has expired/i],
    [403, /don't have permission/i],
    [404, /no longer exists/i],
    [409, /conflicts with something/i],
    [413, /too large/i],
    [500, /went wrong on the server/i],
    [502, /went wrong on the server/i],
    [503, /went wrong on the server/i],
  ];
  it.each(cases)("maps status %i", (status, expected) => {
    const msg = humanizeError(new ApiError(status, "raw server text"));
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
  });
  it("unwraps {error} JSON envelopes from the body", () => {
    expect(humanizeError(new ApiError(400, '{"error":"branch name too long"}'))).toBe("branch name too long");
  });
  it("non-ApiError unknowns get the generic fallback, never undefined", () => {
    expect(humanizeError(new Error("boom"))).toMatch(/something went wrong/i);
    expect(humanizeError(undefined)).toMatch(/something went wrong/i);
    expect(humanizeError({ weird: true })).toMatch(/something went wrong/i);
  });
});
