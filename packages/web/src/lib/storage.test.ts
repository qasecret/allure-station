import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Set up minimal storage stubs on globalThis so the module can run in Node (no window/browser).
// These are installed BEFORE the module import so the try/catch paths exercise both branches.

const realStore: Record<string, string> = {};
const workingStorage = {
  getItem: (k: string) => realStore[k] ?? null,
  setItem: (k: string, v: string) => { realStore[k] = v; },
  removeItem: (k: string) => { delete realStore[k]; },
};
const throwingStorage = {
  getItem: () => { throw new DOMException("The operation is insecure.", "SecurityError"); },
  setItem: () => { throw new DOMException("The operation is insecure.", "SecurityError"); },
  removeItem: () => { throw new DOMException("The operation is insecure.", "SecurityError"); },
};

// Install working stubs so the module loads fine; individual tests swap them in/out.
(globalThis as Record<string, unknown>).sessionStorage = workingStorage;
(globalThis as Record<string, unknown>).localStorage = workingStorage;

// Import AFTER stubs are installed.
import { session, local } from "./storage";

describe("session storage helpers", () => {
  beforeEach(() => {
    // Reset the shared backing store.
    for (const k of Object.keys(realStore)) delete realStore[k];
    (globalThis as Record<string, unknown>).sessionStorage = workingStorage;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).sessionStorage = workingStorage;
  });

  it("get returns null and set is a no-op when sessionStorage throws SecurityError", () => {
    (globalThis as Record<string, unknown>).sessionStorage = throwingStorage;
    expect(() => session.get("x")).not.toThrow();
    expect(session.get("x")).toBeNull();
    expect(() => session.set("x", "v")).not.toThrow();
  });

  it("get and set work normally when sessionStorage is available", () => {
    session.set("test-key", "hello");
    expect(session.get("test-key")).toBe("hello");
  });
});

describe("local storage helpers", () => {
  beforeEach(() => {
    for (const k of Object.keys(realStore)) delete realStore[k];
    (globalThis as Record<string, unknown>).localStorage = workingStorage;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).localStorage = workingStorage;
  });

  it("get returns null and set is a no-op when localStorage throws SecurityError", () => {
    (globalThis as Record<string, unknown>).localStorage = throwingStorage;
    expect(() => local.get("x")).not.toThrow();
    expect(local.get("x")).toBeNull();
    expect(() => local.set("x", "v")).not.toThrow();
  });

  it("get and set work normally when localStorage is available", () => {
    local.set("test-key", "world");
    expect(local.get("test-key")).toBe("world");
  });
});
