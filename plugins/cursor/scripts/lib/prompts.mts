import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts");

export function loadPromptTemplate(name: string): string {
  const promptPath = join(PROMPTS_DIR, `${name}.md`);
  return readFileSync(promptPath, "utf8");
}

export function interpolateTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string): string =>
    Object.hasOwn(variables, key) ? (variables[key] ?? "") : "",
  );
}
