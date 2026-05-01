// plugins/cursor/scripts/lib/hook-payload.mts
import { readFileSync } from "node:fs";
function readHookStdinSync() {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
function parseHookPayload(raw) {
  if (!raw.trim()) return {};
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data;
  } catch {
  }
  return {};
}

export {
  readHookStdinSync,
  parseHookPayload
};
