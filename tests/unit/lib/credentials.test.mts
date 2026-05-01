import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deleteApiKey,
  detectBackend,
  getActiveKeychainSecret,
  type KeychainBackend,
  resetBackendCache,
  resolveApiKeyFromKeychain,
  setActiveKeychainSecret,
  setBackendForTesting,
  storeApiKey,
} from "../../../plugins/cursor/scripts/lib/credentials.mjs";

beforeEach(() => {
  resetBackendCache();
});

afterEach(() => {
  resetBackendCache();
  setActiveKeychainSecret(undefined);
});

function fakeBackend(stored?: string): KeychainBackend & { stored: string | undefined } {
  const state = { stored };
  return {
    name: "fake",
    get stored() {
      return state.stored;
    },
    async get() {
      return state.stored;
    },
    async set(secret: string) {
      state.stored = secret;
    },
    async delete() {
      state.stored = undefined;
    },
  };
}

describe("detectBackend", () => {
  it("returns null when overridden with null", () => {
    setBackendForTesting(null);
    expect(detectBackend()).toBeNull();
  });

  it("returns the injected backend when set", () => {
    const backend = fakeBackend();
    setBackendForTesting(backend);
    expect(detectBackend()).toBe(backend);
  });
});

describe("resolveApiKeyFromKeychain", () => {
  it("returns the stored key with source 'keychain'", async () => {
    setBackendForTesting(fakeBackend("key_stored"));
    const result = await resolveApiKeyFromKeychain();
    expect(result).toEqual({ apiKey: "key_stored", source: "keychain" });
  });

  it("returns undefined when the keychain is empty", async () => {
    setBackendForTesting(fakeBackend(undefined));
    expect(await resolveApiKeyFromKeychain()).toBeUndefined();
  });

  it("returns undefined when no backend is available", async () => {
    setBackendForTesting(null);
    expect(await resolveApiKeyFromKeychain()).toBeUndefined();
  });
});

describe("storeApiKey", () => {
  it("stores a key via the backend", async () => {
    const backend = fakeBackend();
    setBackendForTesting(backend);
    await storeApiKey("key_new");
    expect(backend.stored).toBe("key_new");
  });

  it("throws when no backend is available", async () => {
    setBackendForTesting(null);
    await expect(storeApiKey("key")).rejects.toThrow(/No supported keychain backend/);
  });
});

describe("deleteApiKey", () => {
  it("removes a stored key via the backend", async () => {
    const backend = fakeBackend("key_existing");
    setBackendForTesting(backend);
    await deleteApiKey();
    expect(backend.stored).toBeUndefined();
  });

  it("throws when no backend is available", async () => {
    setBackendForTesting(null);
    await expect(deleteApiKey()).rejects.toThrow(/No supported keychain backend/);
  });
});

describe("activeKeychainSecret", () => {
  it("starts as undefined", () => {
    expect(getActiveKeychainSecret()).toBeUndefined();
  });

  it("round-trips a value", () => {
    setActiveKeychainSecret("secret123");
    expect(getActiveKeychainSecret()).toBe("secret123");
    setActiveKeychainSecret(undefined);
    expect(getActiveKeychainSecret()).toBeUndefined();
  });
});
