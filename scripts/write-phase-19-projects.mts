import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defaultDeps } from "../src/lib/agent/factory";
import { renderPrompt } from "../src/lib/agent/prompts";
import { loadConfig } from "../src/lib/config";
import { readPhase19Tracks } from "../src/lib/content/phase-19-tracks";
import { extractJsonBlock } from "../src/lib/generate/plan-lesson";
import { parseExerciseTargets } from "../src/lib/source/written-functions";

const generatedSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  summary: z.string(),
  time: z.string(),
  languages: z.array(z.string()),
  prerequisites: z.array(z.string()),
  phases: z.array(z.string()),
  tracks: z.array(z.string()),
  brief: z.object({
    problem: z.string(),
    concept: z.string(),
    architecture: z.string(),
    stack: z.array(z.string()),
  }),
  milestones: z.array(z.object({
    id: z.string(),
    title: z.string(),
    task: z.string(),
    body: z.string(),
    doneWhen: z.array(z.string()),
    contractTargets: z.array(z.string()).max(2),
    evidence: z.string(),
  })),
  rubric: z.array(z.object({
    id: z.string(),
    weight: z.number().int(),
    criterion: z.string(),
    measurement: z.string(),
  })),
});

function args(argv: string[]): { agent: "claude" | "codex"; from: number; to: number } {
  const config = loadConfig();
  const out = { agent: config.agent, from: 1, to: 17 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--agent") {
      const value = argv[++i];
      if (value !== "claude" && value !== "codex") throw new Error(`Неизвестный агент ${value}`);
      out.agent = value;
    } else if (argv[i] === "--from") out.from = Number(argv[++i]);
    else if (argv[i] === "--to") out.to = Number(argv[++i]);
    else throw new Error(`Неизвестный аргумент ${argv[i]}`);
  }
  return out;
}

async function main(): Promise<void> {
  const options = args(process.argv.slice(2));
  const config = loadConfig();
  const deps = defaultDeps(config, { agent: options.agent });
  const sourceRoot = path.join(config.sourceDir, "phases", "19-capstone-projects");
  const tracks = readPhase19Tracks(config.contentDir);
  const knownTrackIds = new Set(tracks.map((track) => track.id));
  const dirs = fs.readdirSync(sourceRoot).filter((name) => {
    const number = Number(name.slice(0, 2));
    return number >= options.from && number <= options.to && number <= 17;
  }).sort();

  for (const [index, name] of dirs.entries()) {
    const slug = `19-capstone-projects__${name}`;
    const outputDir = path.join(config.contentDir, "projects", slug);
    const output = path.join(outputDir, "project.json");
    console.log(`[${index + 1}/${dirs.length}] ${name}`);
    if (fs.existsSync(output)) {
      console.log("  уже готово");
      continue;
    }
    const lessonDir = path.join(sourceRoot, name);
    const sourceText = fs.readFileSync(path.join(lessonDir, "docs", "en.md"), "utf8");
    const codeFile = path.join(lessonDir, "code", "main.py");
    const code = fs.readFileSync(codeFile, "utf8");
    const symbols = new Set(parseExerciseTargets(code).map((item) => item.symbol));
    const recommended = tracks.filter((track) => track.projects.includes(name));
    const buildSection = sourceText.split(/^## Build It\s*$/m)[1]?.split(/^## /m)[0] ?? "";
    const expectedMilestones = [...buildSection.matchAll(/^\d+\.\s+/gm)].length;
    const prompt = renderPrompt("plan-project", {
      source_text: sourceText,
      project_code: code,
      tracks: recommended.map((track) => `- ${track.id}: ${track.title}`).join("\n"),
    });

    let last = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const raw = await deps.run(prompt + (last ? `\n\nИсправь прошлую ошибку: ${last}` : ""), () => {});
        const parsed = generatedSchema.parse(extractJsonBlock(raw));
        if (parsed.milestones.length !== expectedMilestones) {
          throw new Error(`нужно ${expectedMilestones} этапов из Build It, получено ${parsed.milestones.length}`);
        }
        if (parsed.milestones.some((item) => !/^m\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id))) {
          throw new Error("milestone id должен иметь форму m01-latin-slug");
        }
        if (parsed.rubric.reduce((sum, item) => sum + item.weight, 0) !== 100) throw new Error("веса рубрики не дают 100");
        if (parsed.tracks.some((id) => !knownTrackIds.has(id))) throw new Error("назван неизвестный трек");
        const used = new Set<string>();
        for (const milestone of parsed.milestones) {
          milestone.contractTargets = milestone.contractTargets.map((target) => {
            if (symbols.has(target)) return target;
            const qualified = [...symbols].filter((symbol) => symbol.endsWith(`.${target}`));
            return qualified.length === 1 ? qualified[0] : target;
          });
          for (const target of milestone.contractTargets) {
            if (!symbols.has(target)) throw new Error(`в коде нет цели ${target}`);
            if (used.has(target)) throw new Error(`цель ${target} назначена дважды`);
            used.add(target);
          }
        }
        fs.mkdirSync(path.join(outputDir, "milestones"), { recursive: true });
        for (const milestone of parsed.milestones) {
          fs.writeFileSync(path.join(outputDir, "milestones", `${milestone.id}.md`), `${milestone.body.trim()}\n`, "utf8");
        }
        const project = {
          ...parsed,
          slug,
          milestones: parsed.milestones.map((milestone) => ({
            id: milestone.id,
            title: milestone.title,
            task: milestone.task,
            doneWhen: milestone.doneWhen,
            contractTargets: milestone.contractTargets,
            evidence: milestone.evidence,
          })),
          sourcePath: path.relative(process.cwd(), path.join(lessonDir, "docs", "en.md")),
          generatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(output, `${JSON.stringify(project, null, 2)}\n`, "utf8");
        console.log(`  готово: ${project.milestones.length} этапов`);
        last = "";
        break;
      } catch (error) {
        last = (error as Error).message;
        console.warn(`  попытка ${attempt}: ${last}`);
      }
    }
    if (last) process.exitCode = 1;
  }
}

await main();
