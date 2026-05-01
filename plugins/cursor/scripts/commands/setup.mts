import type { ModelSelection, SDKModel } from "@cursor/sdk";

import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, optionalString, parseArgs, UsageError } from "../lib/args.mjs";
import {
  DEFAULT_MODEL,
  listModels,
  resolveApiKey,
  validateModel,
  whoami,
} from "../lib/cursor-agent.mjs";
import { readGateConfig, setGateEnabled } from "../lib/gate.mjs";
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
  - CURSOR_API_KEY is set
  - Cursor.me() succeeds (key is valid)
  - Cursor.models.list() returns at least one model

Stop review gate (per workspace, opt-in):
  --enable-gate        Turn on the Stop review gate for this workspace
  --disable-gate       Turn off the Stop review gate for this workspace

Default model (user-wide, used when --model is not passed):
  --set-model <id>     Persist <id> as the default for new agent runs.
                       Validated against Cursor.models.list().
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

/**
 * Flatten the SDK model catalog into selectable variants. Mirrors the cookbook
 * `modelToChoices` shape (one row per concrete `ModelSelection`).
 */
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
      const key = JSON.stringify({
        id: selection.id,
        params: [...(selection.params ?? [])]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((p) => `${p.id}=${p.value}`),
      });
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
  apiKey: { ok: boolean; error?: string };
  account: { ok: boolean; apiKeyName?: string; error?: string };
  models: { ok: boolean; choices: ModelChoice[]; error?: string };
  defaultModel: { id: string; source: DefaultModelSource };
  gate: { enabled: boolean; workspaceRoot: string };
}

interface BuildReportInput {
  workspaceRoot: string;
  gateEnabled: boolean;
  /** Catalog already fetched by the caller — skips the duplicate list call. */
  prefetchedCatalog?: SDKModel[];
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

async function buildReport(input: BuildReportInput): Promise<SetupReport> {
  const resolved = resolveDefaultModel(DEFAULT_MODEL);
  const report: SetupReport = {
    node: { ok: nodeMajor() >= NODE_MIN_MAJOR, version: process.versions.node },
    apiKey: { ok: false },
    account: { ok: false },
    models: { ok: false, choices: [] },
    defaultModel: { id: resolved.model.id, source: resolved.source },
    gate: { enabled: input.gateEnabled, workspaceRoot: input.workspaceRoot },
  };

  try {
    resolveApiKey();
    report.apiKey.ok = true;
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
  lines.push(`Node.js     ${yes(report.node.ok)}  (${report.node.version})`);
  lines.push(
    `API key     ${yes(report.apiKey.ok)}` +
      (report.apiKey.error ? `  ${report.apiKey.error}` : ""),
  );
  if (report.account.ok) {
    lines.push(`Account     ok    (key: ${report.account.apiKeyName ?? "?"})`);
  } else if (report.account.error) {
    lines.push(`Account     fail  ${report.account.error}`);
  }
  if (report.models.ok) {
    lines.push(`Models      ok    (${report.models.choices.length} available)`);
    for (const choice of report.models.choices) {
      lines.push(`  - ${choice.label}  [${choice.selection.id}]`);
    }
  } else if (report.models.error) {
    lines.push(`Models      fail  ${report.models.error}`);
  }
  lines.push(
    `Default     ${report.defaultModel.id}  (${describeSource(report.defaultModel.source)})`,
  );
  lines.push(
    `Stop gate   ${report.gate.enabled ? "on" : "off"}   (workspace: ${report.gate.workspaceRoot})`,
  );
  return `${lines.join("\n")}\n`;
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

export async function runSetup(args: readonly string[], io: CommandIO): Promise<ExitCode> {
  const parsed = parseArgs(args, {
    long: {
      json: "boolean",
      help: "boolean",
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

  const enableGate = bool(parsed, "enable-gate");
  const disableGate = bool(parsed, "disable-gate");
  if (enableGate && disableGate) {
    throw new UsageError("--enable-gate and --disable-gate are mutually exclusive");
  }

  const setModelId = optionalString(parsed, "set-model");
  const clearModel = bool(parsed, "clear-model");
  if (setModelId && clearModel) {
    throw new UsageError("--set-model and --clear-model are mutually exclusive");
  }
  if (setModelId !== undefined && setModelId.trim() === "") {
    throw new UsageError("--set-model requires a non-empty model id");
  }

  // Pre-fetch the catalog when validating --set-model so buildReport can
  // reuse it instead of listing models a second time.
  let prefetchedCatalog: SDKModel[] | undefined;
  if (setModelId) {
    prefetchedCatalog = await listModels();
    await validateModel({ id: setModelId }, { catalog: prefetchedCatalog });
    setDefaultModel({ id: setModelId });
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

  if (bool(parsed, "json")) {
    io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    io.stdout.write(renderReport(report));
  }

  const allOk = report.node.ok && report.apiKey.ok && report.account.ok && report.models.ok;
  return allOk ? 0 : 1;
}
