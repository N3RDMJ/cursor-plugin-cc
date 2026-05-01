#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build } from "esbuild";

const outdir = "plugins/cursor/scripts/bundle";

await build({
  entryPoints: [
    "plugins/cursor/scripts/cursor-companion.mts",
    "plugins/cursor/scripts/session-lifecycle-hook.mts",
    "plugins/cursor/scripts/stop-review-gate-hook.mts",
  ],
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outdir,
  outExtension: { ".js": ".mjs" },
  external: ["@cursor/sdk", "@napi-rs/keyring"],
});

for (const f of await readdir(outdir)) {
  if (!f.endsWith(".mjs")) continue;
  const p = join(outdir, f);
  const src = await readFile(p, "utf8");
  if (src.startsWith("#!")) {
    await writeFile(p, src.replace(/^#![^\n]*\n/, ""));
  }
}
