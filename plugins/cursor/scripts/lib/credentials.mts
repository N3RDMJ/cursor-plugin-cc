import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

function spawnWithStdin(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { timeout: timeoutMs, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(input);
  });
}

const SERVICE = "cursor-plugin-cc";
const ACCOUNT = "default";
const EXEC_TIMEOUT_MS = 5_000;

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

class LinuxSecretTool implements KeychainBackend {
  readonly name = "secret-tool (Secret Service)";

  async get(): Promise<string | undefined> {
    try {
      const { stdout } = await execFile(
        "secret-tool",
        ["lookup", "service", SERVICE, "account", ACCOUNT],
        { timeout: EXEC_TIMEOUT_MS },
      );
      const val = stdout.trimEnd();
      return val.length > 0 ? val : undefined;
    } catch {
      return undefined;
    }
  }

  async set(secret: string): Promise<void> {
    await spawnWithStdin(
      "secret-tool",
      ["store", "--label", `${SERVICE} API key`, "service", SERVICE, "account", ACCOUNT],
      secret,
      EXEC_TIMEOUT_MS,
    );
  }

  async delete(): Promise<void> {
    try {
      await execFile("secret-tool", ["clear", "service", SERVICE, "account", ACCOUNT], {
        timeout: EXEC_TIMEOUT_MS,
      });
    } catch {
      /* already absent */
    }
  }
}

class MacOSSecurity implements KeychainBackend {
  readonly name = "macOS Keychain";

  async get(): Promise<string | undefined> {
    try {
      const { stdout } = await execFile(
        "security",
        ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
        { timeout: EXEC_TIMEOUT_MS },
      );
      const val = stdout.trimEnd();
      return val.length > 0 ? val : undefined;
    } catch {
      return undefined;
    }
  }

  async set(secret: string): Promise<void> {
    try {
      await this.delete();
    } catch {
      /* may not exist yet */
    }
    // Omit -w to keep the secret out of argv (visible via ps).
    // security reads the password from stdin when -w has no argument.
    await spawnWithStdin(
      "security",
      ["add-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-U"],
      `${secret}\n`,
      EXEC_TIMEOUT_MS,
    );
  }

  async delete(): Promise<void> {
    try {
      await execFile("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT], {
        timeout: EXEC_TIMEOUT_MS,
      });
    } catch {
      /* already absent */
    }
  }
}

let cachedBackend: KeychainBackend | null | undefined;

export function detectBackend(): KeychainBackend | null {
  if (cachedBackend !== undefined) return cachedBackend;
  const p = process.platform;
  if (p === "darwin") {
    cachedBackend = new MacOSSecurity();
  } else if (p === "linux") {
    cachedBackend = new LinuxSecretTool();
  } else {
    cachedBackend = null;
  }
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
