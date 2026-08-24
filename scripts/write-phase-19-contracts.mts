import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defaultDeps } from "../src/lib/agent/factory";
import { renderPrompt } from "../src/lib/agent/prompts";
import { loadConfig } from "../src/lib/config";
import { readProject } from "../src/lib/content/project";
import { stubExerciseTarget } from "../src/lib/generate/derive-lab-exercise";
import { extractJsonBlock } from "../src/lib/generate/plan-lesson";
import { runTests } from "../src/lib/practice/run-tests";

const replySchema = z.object({
  tests: z.string().min(1),
  nodes: z.record(z.string(), z.array(z.string().min(1)).min(1)),
});

function options(argv: string[]): { from: number; to: number; agent: "claude" | "codex" } {
  const config = loadConfig();
  const out = { from: 1, to: 17, agent: config.agent };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--from") out.from = Number(argv[++i]);
    else if (argv[i] === "--to") out.to = Number(argv[++i]);
    else if (argv[i] === "--agent") {
      const value = argv[++i];
      if (value !== "claude" && value !== "codex") throw new Error(`Неизвестный агент ${value}`);
      out.agent = value;
    } else throw new Error(`Неизвестный аргумент ${argv[i]}`);
  }
  return out;
}

function green(result: { passed: number; failed: number; errors: number }): boolean {
  return result.passed > 0 && result.failed === 0 && result.errors === 0;
}

async function main(): Promise<void> {
  const opts = options(process.argv.slice(2));
  const config = loadConfig();
  const deps = defaultDeps(config, { agent: opts.agent });
  const sourceRoot = path.join(config.sourceDir, "phases", "19-capstone-projects");
  const dirs = fs.readdirSync(sourceRoot).filter((name) => {
    const number = Number(name.slice(0, 2));
    return number >= opts.from && number <= opts.to && number <= 17;
  }).sort();

  for (const [index, name] of dirs.entries()) {
    const slug = `19-capstone-projects__${name}`;
    const project = readProject(config.contentDir, slug);
    if (!project) {
      console.warn(`[${index + 1}/${dirs.length}] ${name}: сначала нужен project.json`);
      process.exitCode = 1;
      continue;
    }
    const targetRows = project.milestones.flatMap((milestone) =>
      milestone.contractTargets.map((target) => ({ milestone: milestone.id, target })),
    );
    const destination = path.join(config.sourceDir, "learning-projects", `p19-c${name}`);
    if (fs.existsSync(path.join(destination, "project.json"))) {
      console.log(`[${index + 1}/${dirs.length}] ${name}: уже готово`);
      continue;
    }
    console.log(`[${index + 1}/${dirs.length}] ${name}`);
    const code = fs.readFileSync(path.join(sourceRoot, name, "code", "main.py"), "utf8");
    const prompt = renderPrompt("write-project-contracts", {
      project_json: JSON.stringify(project, null, 2),
      project_code: code,
      targets: targetRows.map((row) => `- ${row.milestone}: ${row.target}`).join("\n"),
    });

    let last = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const staging = `${destination}.staging`;
      try {
        const raw = await deps.run(prompt + (last ? `\n\nПредыдущая попытка не прошла: ${last}` : ""), () => {});
        const reply = replySchema.parse(extractJsonBlock(raw));
        const expected = new Set(targetRows.map((row) => row.target));
        if (Object.keys(reply.nodes).length !== expected.size || Object.keys(reply.nodes).some((key) => !expected.has(key))) {
          throw new Error("nodes не совпадают с переданными целями");
        }
        fs.rmSync(staging, { recursive: true, force: true });
        fs.mkdirSync(staging, { recursive: true });
        for (const milestone of project.milestones) {
          if (milestone.contractTargets.length === 0) continue;
          const dir = path.join(staging, milestone.id);
          const solutionDir = path.join(dir, "solution");
          const templateDir = path.join(dir, "contract.template");
          fs.mkdirSync(solutionDir, { recursive: true });
          fs.mkdirSync(templateDir, { recursive: true });
          fs.writeFileSync(path.join(solutionDir, "main.py"), code, "utf8");
          let template = code;
          for (const target of milestone.contractTargets) {
            template = stubExerciseTarget(template, target, `Реализуй контракт этапа «${milestone.title}».`);
          }
          fs.writeFileSync(path.join(templateDir, "main.py"), template, "utf8");
          fs.writeFileSync(path.join(dir, "test_contract.py"), reply.tests, "utf8");
          fs.writeFileSync(path.join(dir, "contract.json"), `${JSON.stringify({
            version: 1,
            targets: milestone.contractTargets.map((target) => ({ file: "main.py", symbol: target, tests: reply.nodes[target], bench: false })),
          }, null, 2)}\n`, "utf8");

          for (const target of milestone.contractTargets) {
            const solution = await runTests({ dir, python: config.python, pythonPath: solutionDir, testNodes: reply.nodes[target] });
            if (!green(solution)) throw new Error(`${milestone.id}/${target}: эталон красный`);
            const stub = await runTests({ dir, python: config.python, pythonPath: templateDir, testNodes: reply.nodes[target] });
            if (green(stub)) throw new Error(`${milestone.id}/${target}: заглушка зелёная`);
          }
        }
        fs.writeFileSync(path.join(staging, "project.json"), `${JSON.stringify({ version: 1, slug, milestones: project.milestones.map((item) => ({ id: item.id, targets: item.contractTargets })) }, null, 2)}\n`, "utf8");
        fs.renameSync(staging, destination);
        console.log(`  готово: ${targetRows.length} швов`);
        last = "";
        break;
      } catch (error) {
        last = (error as Error).message;
        fs.rmSync(staging, { recursive: true, force: true });
        console.warn(`  попытка ${attempt}: ${last}`);
      }
    }
    if (last) process.exitCode = 1;
  }
}

await main();
