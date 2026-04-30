import { describe, expect, it } from "vitest";

import { main as companionMain } from "../../plugins/cursor/scripts/cursor-companion.mjs";
import { main as hookMain } from "../../plugins/cursor/scripts/session-lifecycle-hook.mjs";
import { captureIO } from "../helpers/io.mjs";

describe("cursor-companion CLI", () => {
  it("prints usage and exits 0 with no args", async () => {
    const io = captureIO();
    expect(await companionMain(["node", "cursor-companion"], io)).toBe(0);
    expect(io.captured.stdout.join("")).toMatch(/cursor-companion <command>/);
  });

  it("returns 2 for an unknown command", async () => {
    const io = captureIO();
    expect(await companionMain(["node", "cursor-companion", "bogus"], io)).toBe(2);
    expect(io.captured.stderr.join("")).toMatch(/unknown command/);
  });
});

describe("session-lifecycle-hook", () => {
  it("returns 2 when no event is passed", () => {
    expect(hookMain(["node", "hook"])).toBe(2);
  });

  it("returns 0 for SessionStart and SessionEnd", () => {
    expect(hookMain(["node", "hook", "SessionStart"])).toBe(0);
    expect(hookMain(["node", "hook", "SessionEnd"])).toBe(0);
  });
});
