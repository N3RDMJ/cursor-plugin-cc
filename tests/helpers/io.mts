import { Writable } from "node:stream";
import type { SDKAgent, SDKUserMessage } from "@cursor/sdk";
import { vi } from "vitest";

export interface CapturedIO {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  cwd: () => string;
  env: NodeJS.ProcessEnv;
  captured: { stdout: string[]; stderr: string[] };
}

export function captureIO(cwd: string = process.cwd()): CapturedIO {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sink = (target: string[]): NodeJS.WritableStream =>
    new Writable({
      write(chunk, _enc, cb) {
        target.push(chunk.toString());
        cb();
      },
    });
  return {
    stdout: sink(stdout),
    stderr: sink(stderr),
    cwd: () => cwd,
    env: process.env,
    captured: { stdout, stderr },
  };
}

export const argv = (...rest: string[]): string[] => ["node", "cursor-companion", ...rest];

/**
 * Read the prompt the test passed to a mocked `agent.send`, asserting it was
 * a string. `agent.send` accepts `string | SDKUserMessage`, so an unchecked
 * `as string` cast would silently pass an object through.
 */
export function sentPrompt(agent: SDKAgent, callIndex = 0): string {
  const arg = vi.mocked(agent.send).mock.calls[callIndex]?.[0] as string | SDKUserMessage;
  if (typeof arg !== "string") {
    throw new Error(`expected a string prompt at call ${callIndex}, got ${typeof arg}`);
  }
  return arg;
}
