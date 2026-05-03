import type { ModelSelection, SDKModel } from "@cursor/sdk";

import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, optionalString, parseArgs, UsageError } from "../lib/args.mjs";
import { deleteApiKey, detectBackend, type KeySource, storeApiKey } from "../lib/credentials.mjs";
import {
  DEFAULT_MODEL,
  listModels,
  resolveApiKey,
  validateModel,
  whoami,
} from "../lib/cursor-agent.mjs";
import { readGateConfig, setGateEnabled } from "../lib/gate.mjs";
import {
  type BootstrapStatus,
  installAndRecord,
  isSdkInstalled,
  readBootstrapStatus,
  resolvePluginRoot,
} from "../lib/install.mjs";
import { formatModelSelection, parseModelArg } from "../lib/model-arg.mjs";
import { escapeMarkdownCell } from "../lib/render.mjs";
import { resolveStateDir } from "../lib/state.mjs";
import {
  clearDefaultModel,
  type DefaultModelSource,
  resolveDefaultModel,
  setDefaultModel,
} from "../lib/user-config.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const NODE_MIN_MAJOR = 18;

interface ModelChoice {
  label: string;
  selection: ModelSelection;
  description?: string;
}

const HELP = `cursor-companion setup [flags]

Validates the plugin runtime:
  - Node.js >= ${NODE_MIN_MAJOR}
  - @cursor/sdk is installed (bootstrap.mjs ran successfully)
  - API key is available (env or keychain)
  - Cursor.me() succeeds (key is valid)
  - Cursor.models.list() returns at least one model

SDK installation:
  --install            Run \`npm install --omit=dev\` in the plugin root.
                       Use this when bootstrap reports a failure or the
                       SDK row in the report is "fail".

Credential management:
  --login              Store a Cursor API key in the OS keychain.
                       Reads from stdin (pipe or interactive TTY; input masked as *).
                       Validates via Cursor.me() before storing.
  --logout             Remove the stored key from the OS keychain.

Stop review gate (per workspace, opt-in):
  --enable-gate        Turn on the Stop review gate for this workspace
  --disable-gate       Turn off the Stop review gate for this workspace

Default model (user-wide, used when --model is not passed):
  --set-model <id[:k=v,...]>
                       Persist a model selection as the default for new
                       agent runs. Append \`:key=value,key=value\` to set
                       variant params (e.g. effort level):
                         --set-model gpt-5
                         --set-model gpt-5:reasoning_effort=low
                         --set-model gpt-5:reasoning_effort=high,verbosity=low
                       Validated against Cursor.models.list() — the id and
                       any param keys/values must be in the catalog.
  --clear-model        Remove the persisted default (revert to ${DEFAULT_MODEL.id}).
                       Resolution order: --model flag > CURSOR_MODEL env >
                       persisted default > ${DEFAULT_MODEL.id} fallback.

flags:
  --json               Machine-readable output
  --help, -h
`;

function nodeMajor(): number {
  const m = process.versions.node.match(/^(\d+)\./);
  return m ? Number(m[1]) : 0;
}

export function modelChoices(models: Awaited<ReturnType<typeof listModels>>): ModelChoice[] {
  const choices: ModelChoice[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const baseLabel = model.displayName || model.id;
    const variants = model.variants ?? [];
    if (variants.length === 0) {
      const key = model.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const choice: ModelChoice = { label: baseLabel, selection: { id: model.id } };
      if (model.description) choice.description = model.description;
      choices.push(choice);
      continue;
    }
    for (const variant of variants) {
      const selection: ModelSelection = { id: model.id, params: variant.params };
      const key = formatModelSelection(selection);
      if (seen.has(key)) continue;
      seen.add(key);
      const variantLabel = variant.displayName.trim();
      const label =
        !variantLabel || variantLabel.toLowerCase() === baseLabel.toLowerCase()
          ? baseLabel
          : `${baseLabel} - ${variantLabel}`;
      const choice: ModelChoice = { label, selection };
      const description = variant.description ?? model.description;
      if (description) choice.description = description;
      choices.push(choice);
    }
  }
  return choices;
}

interface SetupReport {
  node: { ok: boolean; version: string };
  sdk: {
    ok: boolean;
    pluginRoot: string;
    bootstrap?: BootstrapStatus;
  };
  apiKey: { ok: boolean; source?: KeySource; error?: string };
  account: { ok: boolean; apiKeyName?: string; error?: string };
  models: { ok: boolean; choices: ModelChoice[]; error?: string };
  defaultModel: { id: string; selector: string; source: DefaultModelSource };
  gate: { enabled: boolean; workspaceRoot: string };
}

interface BuildReportInput {
  workspaceRoot: string;
  gateEnabled: boolean;
  prefetchedCatalog?: SDKModel[];
}

const INSTALL_REMEDIATION = "Run /cursor:setup --install to (re)install the SDK.";

function buildSdkReport(): SetupReport["sdk"] {
  const pluginRoot = resolvePluginRoot();
  // A loadable SDK overrides a stale `ok: false` from a prior failed bootstrap
  // (e.g. the user fixed the install manually) — otherwise the row would lie.
  const ok = isSdkInstalled(pluginRoot);
  const bootstrap = readBootstrapStatus(pluginRoot);
  const sdk: SetupReport["sdk"] = { ok, pluginRoot };
  if (bootstrap) sdk.bootstrap = bootstrap;
  return sdk;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

async function buildReport(input: BuildReportInput): Promise<SetupReport> {
  const resolved = resolveDefaultModel(DEFAULT_MODEL);
  const report: SetupReport = {
    node: { ok: nodeMajor() >= NODE_MIN_MAJOR, version: process.versions.node },
    sdk: buildSdkReport(),
    apiKey: { ok: false },
    account: { ok: false },
    models: { ok: false, choices: [] },
    defaultModel: {
      id: resolved.model.id,
      selector: formatModelSelection(resolved.model),
      source: resolved.source,
    },
    gate: { enabled: input.gateEnabled, workspaceRoot: input.workspaceRoot },
  };

  try {
    const { source } = await resolveApiKey();
    report.apiKey.ok = true;
    report.apiKey.source = source;
  } catch (err) {
    report.apiKey.error = errorMessage(err);
    return report;
  }

  const modelsPromise = input.prefetchedCatalog
    ? Promise.resolve(input.prefetchedCatalog)
    : listModels();
  const [accountResult, modelsResult] = await Promise.allSettled([whoami(), modelsPromise]);

  if (accountResult.status === "fulfilled") {
    report.account.ok = true;
    report.account.apiKeyName = accountResult.value.apiKeyName;
  } else {
    report.account.error = errorMessage(accountResult.reason);
  }

  if (modelsResult.status === "fulfilled") {
    report.models.choices = modelChoices(modelsResult.value);
    report.models.ok = report.models.choices.length > 0;
  } else {
    report.models.error = errorMessage(modelsResult.reason);
  }

  return report;
}

function renderReport(report: SetupReport): string {
  const lines: string[] = [];
  const yes = (ok: boolean): string => (ok ? "ok" : "fail");
  lines.push("# Cursor Setup");
  lines.push("");
  lines.push("| Check | Result | Detail |");
  lines.push("| --- | --- | --- |");
  const row = (label: string, result: string, detail: string): void => {
    lines.push(
      `| ${escapeMarkdownCell(label)} | ${escapeMarkdownCell(result)} | ${escapeMarkdownCell(detail)} |`,
    );
  };
  row("Node.js", yes(report.node.ok), report.node.version);
  row("SDK", yes(report.sdk.ok), describeSdk(report.sdk));
  const keyDetail = report.apiKey.ok
    ? `source: ${report.apiKey.source}`
    : (report.apiKey.error ?? "");
  row("API key", yes(report.apiKey.ok), keyDetail);
  if (report.account.ok) {
    row("Account", "ok", `key: ${report.account.apiKeyName ?? "?"}`);
  } else if (report.account.error) {
    row("Account", "fail", report.account.error);
  }
  if (report.models.ok) {
    row("Models", "ok", `${report.models.choices.length} available`);
  } else if (report.models.error) {
    row("Models", "fail", report.models.error);
  }
  row("Default", report.defaultModel.selector, describeSource(report.defaultModel.source));
  row("Stop gate", report.gate.enabled ? "on" : "off", `workspace: ${report.gate.workspaceRoot}`);

  if (report.models.ok && report.models.choices.length > 0) {
    lines.push("");
    lines.push("**Available models:**");
    for (const choice of report.models.choices) {
      lines.push(`- ${choice.label} \`[${formatModelSelection(choice.selection)}]\``);
    }
  }
  if (!report.sdk.ok) {
    lines.push("");
    lines.push(`> ${INSTALL_REMEDIATION}`);
  }
  return `${lines.join("\n")}\n`;
}

function describeSdk(sdk: SetupReport["sdk"]): string {
  if (sdk.ok) {
    if (sdk.bootstrap?.ok) return `installed (last bootstrap: ${sdk.bootstrap.attemptedAt})`;
    return "installed";
  }
  if (sdk.bootstrap?.error) return `bootstrap failed: ${sdk.bootstrap.error}`;
  return "not installed";
}

function describeSource(source: DefaultModelSource): string {
  switch (source) {
    case "env":
      return "from CURSOR_MODEL env";
    case "config":
      return "from persisted default";
    case "fallback":
      return "built-in fallback";
  }
}

async function readHiddenInput(io: CommandIO): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk: string) => {
        data += chunk;
      });
      stdin.on("end", () => resolve(data.trim()));
      stdin.on("error", reject);
      stdin.resume();
      return;
    }
    io.stderr.write("Enter Cursor API key: ");
    const prev = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    let buf = "";
    const onData = (chunk: Buffer | string) => {
      const str = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      for (const ch of str) {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") {
          stdin.setRawMode(!!prev);
          stdin.pause();
          stdin.removeListener("data", onData);
          io.stderr.write("\n");
          resolve(buf.trim());
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(!!prev);
          stdin.pause();
          stdin.removeListener("data", onData);
          reject(new Error("Aborted"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            io.stderr.write("\b \b");
          }
          continue;
        }
        const code = ch.codePointAt(0) ?? 0;
        /* Skip other control characters (including paste noise). */
        if (code < 32 && ch !== "\t") continue;
        buf += ch;
        io.stderr.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

function keychainUnavailableMessage(detail?: string): string {
  const lines = [
    "Could not store the Cursor API key in the OS keychain.",
    "",
    "Recommended:",
    "  1. Run the local keychain helper from a normal terminal:",
    "     ~/.claude/cursor-login",
    "  2. If keychain storage is not available, use CURSOR_API_KEY instead:",
    "     echo 'export CURSOR_API_KEY=\"YOUR_CURSOR_API_KEY_HERE\"' >> ~/.bashrc",
    "",
    "On WSL/Linux, the keychain backend requires Secret Service. Install it with:",
    "  sudo apt-get install gnome-keyring libsecret-tools dbus-user-session",
  ];
  if (detail) {
    lines.push("", `Underlying error: ${detail}`);
  }
  return lines.join("\n");
}

async function runLogin(io: CommandIO, json: boolean): Promise<ExitCode> {
  const backend = detectBackend();
  if (!backend) {
    const msg = keychainUnavailableMessage("No supported keychain backend on this platform.");
    if (json) {
      io.stdout.write(`${JSON.stringify({ ok: false, error: msg })}\n`);
    } else {
      io.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  const key = await readHiddenInput(io);
  if (!key) {
    const msg = "No key provided.";
    if (json) {
      io.stdout.write(`${JSON.stringify({ ok: false, error: msg })}\n`);
    } else {
      io.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  let apiKeyName: string | undefined;
  try {
    const user = await whoami({ apiKey: key, retry: { attempts: 1 } });
    apiKeyName = user.apiKeyName;
  } catch (err) {
    const msg = `Validation failed: ${errorMessage(err)}`;
    if (json) {
      io.stdout.write(`${JSON.stringify({ ok: false, error: msg })}\n`);
    } else {
      io.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  try {
    await storeApiKey(key);
  } catch (err) {
    const msg = keychainUnavailableMessage(errorMessage(err));
    if (json) {
      io.stdout.write(`${JSON.stringify({ ok: false, error: msg })}\n`);
    } else {
      io.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  if (json) {
    io.stdout.write(
      `${JSON.stringify({ ok: true, source: "keychain", backend: backend.name, apiKeyName })}\n`,
    );
  } else {
    io.stdout.write(`Key stored in ${backend.name}${apiKeyName ? ` (${apiKeyName})` : ""}\n`);
  }
  return 0;
}

async function runInstall(io: CommandIO, json: boolean): Promise<ExitCode> {
  const pluginRoot = resolvePluginRoot();
  if (!json) {
    io.stdout.write(`Installing @cursor/sdk in ${pluginRoot}\n`);
  }
  const result = await installAndRecord(pluginRoot, {
    onOutput: json ? undefined : (chunk) => io.stderr.write(chunk),
  });

  if (json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          ok: result.ok,
          pluginRoot,
          durationMs: result.durationMs,
          command: result.command,
          ...(result.error ? { error: result.error } : {}),
        },
        null,
        2,
      )}\n`,
    );
  } else if (result.ok) {
    io.stdout.write(`Install succeeded in ${result.durationMs}ms.\n`);
  } else {
    io.stderr.write(`Install failed: ${result.error ?? "unknown error"}\n`);
  }
  return result.ok ? 0 : 1;
}

async function runLogout(io: CommandIO, json: boolean): Promise<ExitCode> {
  const backend = detectBackend();
  if (!backend) {
    const msg = "No supported keychain backend on this platform.";
    if (json) {
      io.stdout.write(`${JSON.stringify({ ok: false, error: msg })}\n`);
    } else {
      io.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  await deleteApiKey();

  if (json) {
    io.stdout.write(`${JSON.stringify({ ok: true, backend: backend.name })}\n`);
  } else {
    io.stdout.write(`Key removed from ${backend.name}\n`);
  }
  return 0;
}

export async function runSetup(args: readonly string[], io: CommandIO): Promise<ExitCode> {
  const parsed = parseArgs(args, {
    long: {
      json: "boolean",
      help: "boolean",
      install: "boolean",
      login: "boolean",
      logout: "boolean",
      "enable-gate": "boolean",
      "disable-gate": "boolean",
      "set-model": "string",
      "clear-model": "boolean",
    },
    short: { h: "help" },
  });
  if (bool(parsed, "help")) {
    io.stdout.write(HELP);
    return 0;
  }

  const jsonFlag = bool(parsed, "json");

  const exclusive = ["install", "login", "logout"].filter((flag) => bool(parsed, flag));
  if (exclusive.length > 1) {
    throw new UsageError(`${exclusive.map((f) => `--${f}`).join(" and ")} are mutually exclusive`);
  }
  if (bool(parsed, "install")) return runInstall(io, jsonFlag);
  if (bool(parsed, "login")) return runLogin(io, jsonFlag);
  if (bool(parsed, "logout")) return runLogout(io, jsonFlag);

  const enableGate = bool(parsed, "enable-gate");
  const disableGate = bool(parsed, "disable-gate");
  if (enableGate && disableGate) {
    throw new UsageError("--enable-gate and --disable-gate are mutually exclusive");
  }

  const setModelArg = optionalString(parsed, "set-model");
  const clearModel = bool(parsed, "clear-model");
  if (setModelArg && clearModel) {
    throw new UsageError("--set-model and --clear-model are mutually exclusive");
  }
  if (setModelArg !== undefined && setModelArg.trim() === "") {
    throw new UsageError("--set-model requires a non-empty model id");
  }

  let prefetchedCatalog: SDKModel[] | undefined;
  if (setModelArg) {
    const selection = parseModelArg(setModelArg);
    prefetchedCatalog = await listModels();
    await validateModel(selection, { catalog: prefetchedCatalog });
    setDefaultModel(selection);
  } else if (clearModel) {
    clearDefaultModel();
  }

  const workspaceRoot = resolveWorkspaceRoot(io.cwd());
  const stateDir = resolveStateDir(workspaceRoot);
  const togglingGate = enableGate || disableGate;
  const gateEnabled = togglingGate
    ? setGateEnabled(stateDir, enableGate).enabled
    : readGateConfig(stateDir).enabled;

  const report = await buildReport({
    workspaceRoot,
    gateEnabled,
    ...(prefetchedCatalog ? { prefetchedCatalog } : {}),
  });

  if (jsonFlag) {
    io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    io.stdout.write(renderReport(report));
  }

  const allOk =
    report.node.ok && report.sdk.ok && report.apiKey.ok && report.account.ok && report.models.ok;
  return allOk ? 0 : 1;
}
