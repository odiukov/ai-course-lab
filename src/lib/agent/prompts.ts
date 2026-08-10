import fs from "node:fs";
import path from "node:path";

export type PromptName = "plan-lesson" | "write-step" | "explain" | "review-code";

export function renderPrompt(name: PromptName, vars: Record<string, string>): string {
  const file = path.join(process.cwd(), "prompts", `${name}.md`);
  const template = fs.readFileSync(file, "utf8");
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`Промпт ${name}: не передана переменная ${key}`);
    return value;
  });
  return rendered;
}
