const SERVICE = "cursor-plugin-cc";
const ACCOUNT = "default";

export type KeySource = "explicit" | "env" | "keychain" | "none";

export interface ResolvedKey {
  apiKey: string;
  source: Exclude<KeySource, "none">;
}

export interface KeychainBackend {
  get(): Promise<string | undefined>;
  set(secret: string): Promise<void>;
  delete(): Promise<void>;
  readonly name: string;
}

class NativeKeyring implements KeychainBackend {
  readonly name = "OS keychain";

  async get(): Promise<string | undefined> {
    try {
      const Entry = await loadEntry();
      const val = new Entry(SERVICE, ACCOUNT).getPassword();
      return val && val.length > 0 ? val : undefined;
    } catch {
      return undefined;
    }
  }

  async set(secret: string): Promise<void> {
    const Entry = await loadEntry();
    new Entry(SERVICE, ACCOUNT).setPassword(secret);
  }

  async delete(): Promise<void> {
    try {
      const Entry = await loadEntry();
      new Entry(SERVICE, ACCOUNT).deletePassword();
    } catch {
      /* already absent */
    }
  }
}

let cachedBackend: KeychainBackend | null | undefined;
let entryPromise: Promise<typeof import("@napi-rs/keyring").Entry> | undefined;

async function loadEntry(): Promise<typeof import("@napi-rs/keyring").Entry> {
  entryPromise ??= import("@napi-rs/keyring").then((mod) => mod.Entry);
  return entryPromise;
}

export function detectBackend(): KeychainBackend | null {
  if (cachedBackend !== undefined) return cachedBackend;
  const p = process.platform;
  cachedBackend = p === "darwin" || p === "linux" || p === "win32" ? new NativeKeyring() : null;
  return cachedBackend;
}

export function resetBackendCache(): void {
  cachedBackend = undefined;
}

export function setBackendForTesting(backend: KeychainBackend | null): void {
  cachedBackend = backend;
}

export async function resolveApiKeyFromKeychain(): Promise<ResolvedKey | undefined> {
  const backend = detectBackend();
  if (!backend) return undefined;
  const secret = await backend.get();
  if (!secret || secret.trim() === "") return undefined;
  return { apiKey: secret, source: "keychain" };
}

export async function storeApiKey(secret: string): Promise<void> {
  const backend = detectBackend();
  if (!backend) {
    throw new Error(
      "No supported keychain backend found. Use CURSOR_API_KEY environment variable instead.",
    );
  }
  await backend.set(secret);
}

export async function deleteApiKey(): Promise<void> {
  const backend = detectBackend();
  if (!backend) {
    throw new Error("No supported keychain backend found.");
  }
  await backend.delete();
}

let activeKeychainSecret: string | undefined;

export function getActiveKeychainSecret(): string | undefined {
  return activeKeychainSecret;
}

export function setActiveKeychainSecret(secret: string | undefined): void {
  activeKeychainSecret = secret;
}
