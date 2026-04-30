import { describe, expect, it, vi } from "vitest";

import { withRetry } from "../../../plugins/cursor/scripts/lib/retry.mjs";

const recordingSleep = (delays: number[]) => async (ms: number) => {
  delays.push(ms);
};

describe("withRetry", () => {
  it("returns the result of the first attempt when it succeeds", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries retryable errors with exponential backoff and resolves once one succeeds", async () => {
    const delays: number[] = [];
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("net1"), { isRetryable: true }))
      .mockRejectedValueOnce(Object.assign(new Error("net2"), { isRetryable: true }))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, { sleep: recordingSleep(delays) });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([200, 400]); // base, base*2
  });

  it("rethrows after exhausting the retry budget", async () => {
    const error = Object.assign(new Error("rate limited"), { isRetryable: true });
    const fn = vi.fn(async () => {
      throw error;
    });
    await expect(withRetry(fn, { attempts: 3, sleep: async () => undefined })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const error = Object.assign(new Error("auth"), { isRetryable: false });
    const fn = vi.fn(async () => {
      throw error;
    });
    await expect(withRetry(fn)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("treats absent isRetryable as non-retryable", async () => {
    const fn = vi.fn(async () => {
      throw new Error("plain");
    });
    await expect(withRetry(fn)).rejects.toThrow("plain");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("caps backoff at maxDelayMs", async () => {
    const delays: number[] = [];
    const fn = vi.fn(async () => {
      throw Object.assign(new Error("e"), { isRetryable: true });
    });
    await expect(
      withRetry(fn, {
        attempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 1500,
        sleep: recordingSleep(delays),
      }),
    ).rejects.toThrow();
    expect(delays).toEqual([1000, 1500, 1500, 1500]);
  });

  it("honors a custom shouldRetry predicate", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      throw new Error(`attempt-${calls}`);
    });
    await expect(
      withRetry(fn, {
        attempts: 4,
        sleep: async () => undefined,
        shouldRetry: (err) => (err as Error).message !== "attempt-2",
      }),
    ).rejects.toThrow("attempt-2");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
