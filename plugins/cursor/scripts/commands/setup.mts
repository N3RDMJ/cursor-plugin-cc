import type { ModelSelection } from "@cursor/sdk";

import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, parseArgs, UsageError } from "../lib/args.mjs";
import { listModels, resolveApiKey, whoami } from "../lib/cursor-agent.mjs";
import { readGateConfig, setGateEnabled } from "../lib/gate.mjs";
import { ensureStateDir, resolveStateDir } from "../lib/state.mjs";
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
  gate: { enabled: boolean; workspaceRoot: string };
}

async function buildReport(workspaceRoot: string, gateEnabled: boolean): Promise<SetupReport> {
  const report: SetupReport = {
    node: { ok: nodeMajor() >= NODE_MIN_MAJOR, version: process.versions.node },
    apiKey: { ok: false },
    account: { ok: false },
    models: { ok: false, choices: [] },
    gate: { enabled: gateEnabled, workspaceRoot },
  };

  try {
    resolveApiKey();
    report.apiKey.ok = true;
  } catch (err) {
    report.apiKey.error = err instanceof Error ? err.message : String(err);
    return report;
  }

  try {
    const me = await whoami();
    report.account.ok = true;
    report.account.apiKeyName = me.apiKeyName;
  } catch (err) {
    report.account.error = err instanceof Error ? err.message : String(err);
  }

  try {
    const models = await listModels();
    report.models.choices = modelChoices(models);
    report.models.ok = report.models.choices.length > 0;
  } catch (err) {
    report.models.error = err instanceof Error ? err.message : String(err);
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
    `Stop gate   ${report.gate.enabled ? "on" : "off"}   (workspace: ${report.gate.workspaceRoot})`,
  );
  return `${lines.join("\n")}\n`;
}

export async function runSetup(args: readonly string[], io: CommandIO): Promise<ExitCode> {
  const parsed = parseArgs(args, {
    long: {
      json: "boolean",
      help: "boolean",
      "enable-gate": "boolean",
      "disable-gate": "boolean",
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

  const workspaceRoot = resolveWorkspaceRoot(io.cwd());
  const stateDir = resolveStateDir(workspaceRoot);

  let gateEnabled: boolean;
  if (enableGate || disableGate) {
    ensureStateDir(stateDir);
    gateEnabled = setGateEnabled(stateDir, enableGate).enabled;
  } else {
    gateEnabled = readGateConfig(stateDir).enabled;
  }

  const report = await buildReport(workspaceRoot, gateEnabled);

  if (bool(parsed, "json")) {
    io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    io.stdout.write(renderReport(report));
  }

  const allOk = report.node.ok && report.apiKey.ok && report.account.ok && report.models.ok;
  return allOk ? 0 : 1;
}
