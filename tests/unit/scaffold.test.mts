import { describe, expect, it, vi } from "vitest";
import { main as companionMain } from "../../plugins/cursor/scripts/cursor-companion.mjs";
import { main as hookMain } from "../../plugins/cursor/scripts/session-lifecycle-hook.mjs";

describe("cursor-companion CLI", () => {
  it("prints usage and exits 0 with no args", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(companionMain(["node", "cursor-companion"])).toBe(0);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("returns 2 for an unknown command", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(companionMain(["node", "cursor-companion", "bogus"])).toBe(2);
    err.mockRestore();
  });

  it("returns 1 for a known command (not implemented yet)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(companionMain(["node", "cursor-companion", "task"])).toBe(1);
    err.mockRestore();
  });
});

describe("session-lifecycle-hook", () => {
  it("returns 2 when no event is passed", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(hookMain(["node", "hook"])).toBe(2);
    err.mockRestore();
  });

  it("returns 0 for SessionStart and SessionEnd", () => {
    expect(hookMain(["node", "hook", "SessionStart"])).toBe(0);
    expect(hookMain(["node", "hook", "SessionEnd"])).toBe(0);
  });
});
