import type { AgentEvent } from "./cursor-agent.mjs";
import { redactError } from "./redact.mjs";
import type { JobIndexEntry } from "./state.mjs";

/**
 * Format a duration in milliseconds for terminal display. Sub-second values
 * stay in ms; everything above renders as seconds with one decimal.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Compact whitespace for inline display: collapse runs of whitespace to a
 * single space, trim ends. Used to keep multi-line tool args / status
 * messages on a single annotated line.
 */
export function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const TOOL_SUMMARY_KEYS: Record<string, string[][]> = {
  read: [["path", "filePath", "target_file", "absolutePath"], ["offset"], ["limit"]],
  glob: [
    ["pattern", "glob", "glob_pattern"],
    ["path", "cwd", "target_directory"],
  ],
  grep: [["pattern", "query"], ["path"], ["glob"], ["type"]],
  search: [["pattern", "query"], ["path"], ["glob"], ["type"]],
  shell: [
    ["command", "cmd"],
    ["cwd", "working_directory"],
  ],
  terminal: [
    ["command", "cmd"],
    ["cwd", "working_directory"],
  ],
  command: [
    ["command", "cmd"],
    ["cwd", "working_directory"],
  ],
  edit: [["path", "target_file", "file"], ["instruction"]],
  write: [["path", "target_file", "file"], ["instruction"]],
  patch: [["path", "target_file", "file"], ["instruction"]],
};

const TOOL_SUMMARY_FALLBACK: string[][] = [
  ["path", "file", "target_file"],
  ["pattern", "query", "command"],
];

function getToolSummaryKeys(toolName: string): string[][] {
  const lower = toolName.toLowerCase();
  for (const [needle, keys] of Object.entries(TOOL_SUMMARY_KEYS)) {
    if (lower.includes(needle)) return keys;
  }
  return TOOL_SUMMARY_FALLBACK;
}

function shortenValue(value: string, maxLength = 80): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function formatArgValue(value: unknown): string | undefined {
  if (typeof value === "string") return shortenValue(value.replace(/\s+/g, " ").trim());
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, 3).map(formatArgValue).filter(Boolean) as string[];
    return items.length > 0 ? `[${items.join(",")}]` : undefined;
  }
  return undefined;
}

/**
 * One-line summary of a tool call's args, indexed by likely-relevant keys for
 * common tool names (read/glob/grep/shell/edit). Returns `undefined` when no
 * summary value can be extracted — caller should fall back to just the name.
 */
export function summarizeToolArgs(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const groups = getToolSummaryKeys(toolName);
  const parts: string[] = [];
  for (const keys of groups) {
    for (const key of keys) {
      const value = record[key];
      const formatted = formatArgValue(value);
      if (formatted) {
        parts.push(`${key}=${formatted}`);
        break;
      }
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export interface RenderEventOptions {
  /** Suppress non-error status events to keep stderr quiet. Default false. */
  quietStatus?: boolean;
  /** Suppress thinking token events (word-by-word noise). Default false. */
  quietThinking?: boolean;
}

export interface RenderedEvent {
  /** Lines to write to stdout — typically assistant text only. */
  stdout?: string;
  /** Lines to write to stderr — annotations like [tool], [status]. */
  stderr?: string;
}

/**
 * Format an `AgentEvent` for plain-text terminal output. Mirrors the
 * cookbook's `renderPlainEvent` but operates on our flat AgentEvent shape:
 *
 * - `assistant_text`  → stdout (no annotation)
 * - `thinking`        → `[thinking] ...` on stderr (compacted)
 * - `tool`            → `[tool] <status> <name> <args-summary>` on stderr
 * - `status`          → `[status] <STATE> <message>` on stderr (skipped on
 *                       FINISHED unless verbose)
 * - `task`            → `[task] <status> <text>` on stderr
 * - `system`          → no output (init noise)
 */
export function renderStreamEvent(
  event: AgentEvent,
  options: RenderEventOptions = {},
): RenderedEvent {
  switch (event.type) {
    case "assistant_text":
      return { stdout: event.text };
    case "thinking": {
      if (options.quietThinking) return {};
      const t = compactText(event.text);
      return t ? { stderr: `[thinking] ${t}\n` } : {};
    }
    case "tool": {
      const summary = summarizeToolArgs(event.name, event.args);
      const tail = summary ? ` ${summary}` : "";
      return { stderr: `[tool] ${event.status} ${event.name}${tail}\n` };
    }
    case "status": {
      if (options.quietStatus && event.status === "finished") return {};
      const msg = event.message ? ` ${compactText(event.message)}` : "";
      return { stderr: `[status] ${event.status}${msg}\n` };
    }
    case "task": {
      const head = [event.status, event.text].filter((s): s is string => Boolean(s));
      if (head.length === 0) return {};
      return { stderr: `[task] ${compactText(head.join(" "))}\n` };
    }
    case "system":
      return {};
  }
}

export interface JobTableRow {
  id: string;
  type: string;
  status: string;
  phase: string;
  age: string;
  summary: string;
}

const TABLE_HEADERS: Array<keyof JobTableRow> = ["id", "type", "status", "phase", "age", "summary"];

function rowsFromJobs(jobs: JobIndexEntry[], now: number): JobTableRow[] {
  return jobs.map((job) => {
    const created = Date.parse(job.createdAt);
    const ageMs = Number.isFinite(created) ? now - created : 0;
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      phase: job.phase ? compactText(job.phase).slice(0, 40) : "",
      age: formatAge(ageMs),
      summary: job.summary ? compactText(job.summary).slice(0, 60) : "",
    };
  });
}

/**
 * Compact age string for table columns: `12s` / `5m` / `3h` / `7d`. Returns
 * `?` for invalid/negative inputs so the table never crashes on unparseable
 * timestamps.
 */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/** Convert an ISO timestamp to a relative age string (returns `?` if unparseable). */
export function ageFromIso(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? formatAge(now - t) : "?";
}

/**
 * Render a job-index list as an aligned text table. No color, no Unicode box
 * drawing — keeps output stable in CI logs and terminals without ANSI support.
 */
export function renderJobTable(jobs: JobIndexEntry[], now: number = Date.now()): string {
  if (jobs.length === 0) return "(no jobs)\n";
  const rows = rowsFromJobs(jobs, now);
  const widths: Record<keyof JobTableRow, number> = {
    id: "id".length,
    type: "type".length,
    status: "status".length,
    phase: "phase".length,
    age: "age".length,
    summary: "summary".length,
  };
  for (const r of rows) {
    for (const key of TABLE_HEADERS) {
      widths[key] = Math.max(widths[key], r[key].length);
    }
  }
  const header = TABLE_HEADERS.map((k) => k.toUpperCase().padEnd(widths[k])).join("  ");
  const separator = TABLE_HEADERS.map((k) => "-".repeat(widths[k])).join("  ");
  const body = rows
    .map((r) => TABLE_HEADERS.map((k) => r[k].padEnd(widths[k])).join("  "))
    .join("\n");
  return `${header}\n${separator}\n${body}\n`;
}

/* -------------------------------------------------------------------------
 * Structured review rendering — used by §3.3 review subcommand.
 * ----------------------------------------------------------------------- */

export type ReviewSeverity = "critical" | "high" | "medium" | "low";
export type ReviewVerdict = "approve" | "needs-attention";

export interface ReviewFinding {
  severity: ReviewSeverity;
  title: string;
  body: string;
  file: string;
  line_start: number;
  line_end: number;
  confidence: number;
  recommendation: string;
}

export interface ReviewOutput {
  verdict: ReviewVerdict;
  summary: string;
  findings: ReviewFinding[];
  next_steps: string[];
}

const SEVERITY_ORDER: Record<ReviewSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Format a structured review for terminal display. Findings sorted by
 * severity then file. No ANSI color — callers can wrap output if they need it.
 */
export function renderReviewResult(review: ReviewOutput): string {
  const lines: string[] = [];
  lines.push(`verdict: ${review.verdict}`);
  if (review.summary) lines.push("", review.summary);

  const findings = [...review.findings].sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    return a.file.localeCompare(b.file);
  });

  if (findings.length === 0) {
    lines.push("", "findings: (none)");
  } else {
    lines.push("", `findings: ${findings.length}`);
    for (const f of findings) {
      const loc =
        f.line_start === f.line_end
          ? `${f.file}:${f.line_start}`
          : `${f.file}:${f.line_start}-${f.line_end}`;
      const conf = Number.isFinite(f.confidence) ? `(confidence ${f.confidence.toFixed(2)})` : "";
      lines.push("", `[${f.severity.toUpperCase()}] ${f.title} — ${loc} ${conf}`.trim(), f.body);
      if (f.recommendation) {
        lines.push(`  → ${f.recommendation}`);
      }
    }
  }

  if (review.next_steps.length > 0) {
    lines.push("", "next steps:");
    for (const step of review.next_steps) {
      lines.push(`  - ${step}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Consistent error formatting for CLI failures. Scrubs `CURSOR_API_KEY` from
 * the message before rendering — SDK errors occasionally carry the request URL
 * (with the key in a query parameter) inside `Error.cause`.
 */
export function renderError(error: unknown): string {
  return `error: ${redactError(error)}\n`;
}
