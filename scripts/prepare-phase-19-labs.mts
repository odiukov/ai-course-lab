import fs from "node:fs";
import path from "node:path";
import { defaultDeps } from "../src/lib/agent/factory";
import { renderPrompt } from "../src/lib/agent/prompts";
import { loadConfig } from "../src/lib/config";
import {
  deriveLabExercise,
  type LabExerciseSpec,
  type LabResourceSpec,
} from "../src/lib/generate/derive-lab-exercise";
import { extractJsonBlock } from "../src/lib/generate/plan-lesson";
import { verifyDerivedLabExercise } from "../src/lib/generate/verify-lab-exercise";
import { parseExerciseTargets } from "../src/lib/source/written-functions";

interface Args {
  from: number;
  to: number;
  agent: "claude" | "codex";
  force: boolean;
}

const PHASE = "19-capstone-projects";
const ATTEMPTS = 3;

function parseArgs(argv: string[]): Args {
  const config = loadConfig();
  const out: Args = { from: 20, to: 87, agent: config.agent, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") out.from = Number(argv[++i]);
    else if (arg === "--to") out.to = Number(argv[++i]);
    else if (arg === "--agent") {
      const value = argv[++i];
      if (value !== "claude" && value !== "codex") throw new Error(`Неизвестный агент ${value}`);
      out.agent = value;
    } else if (arg === "--force") out.force = true;
    else throw new Error(`Неизвестный аргумент ${arg}`);
  }
  if (!Number.isInteger(out.from) || !Number.isInteger(out.to) || out.from < 20 || out.to > 87 || out.from > out.to) {
    throw new Error("Диапазон должен лежать внутри 20–87");
  }
  return out;
}

const resourceMap: Record<number, LabResourceSpec[]> = {
  57: [54, 55, 56].map((number) => ({
    source: `../../${number}-${number === 54 ? "paper-writer" : number === 55 ? "critic-loop" : "iteration-scheduler"}/code`,
    target: `_resources/${number}-${number === 54 ? "paper-writer" : number === 55 ? "critic-loop" : "iteration-scheduler"}/code`,
  })),
  59: [{ source: "../../58-vision-encoder-patches/code", target: "_resources/58-vision-encoder-patches/code" }],
  60: [
    { source: "../../58-vision-encoder-patches/code", target: "_resources/58-vision-encoder-patches/code" },
    { source: "../../59-vit-transformer/code", target: "_resources/59-vit-transformer/code" },
  ],
  62: [
    { source: "../../58-vision-encoder-patches/code", target: "_resources/58-vision-encoder-patches/code" },
    { source: "../../59-vit-transformer/code", target: "_resources/59-vit-transformer/code" },
    { source: "../../60-projection-layer-modality-align/code", target: "_resources/60-projection-layer-modality-align/code" },
    { source: "../../61-cross-attention-fusion/code", target: "_resources/61-cross-attention-fusion/code" },
  ],
  63: [58, 59, 60, 61, 62].map((number) => {
    const names: Record<number, string> = {
      58: "vision-encoder-patches",
      59: "vit-transformer",
      60: "projection-layer-modality-align",
      61: "cross-attention-fusion",
      62: "vision-language-pretraining",
    };
    return {
      source: `../../${number}-${names[number]}/code`,
      target: `_resources/${number}-${names[number]}/code`,
    };
  }),
  75: [70, 71, 72, 73, 74].map((number) => {
    const names: Record<number, string> = {
      70: "task-spec-format",
      71: "classical-metrics",
      72: "code-exec-metric",
      73: "perplexity-calibration",
      74: "leaderboard-aggregation",
    };
    return {
      source: `../../${number}-${names[number]}/code`,
      target: `_resources/${number}-${names[number]}/code`,
    };
  }),
  83: [{
    source: "../../82-jailbreak-taxonomy/outputs",
    target: "_resources/82-jailbreak-taxonomy/outputs",
  }],
  87: [
    { source: "../../82-jailbreak-taxonomy/outputs", target: "_resources/82-jailbreak-taxonomy/outputs" },
    { source: "../../83-prompt-injection-detector/code", target: "_resources/83-prompt-injection-detector/code" },
    { source: "../../85-content-classifier-integration/code", target: "_resources/85-content-classifier-integration/code" },
    { source: "../../86-constitutional-rules-engine/code", target: "_resources/86-constitutional-rules-engine/code" },
  ],
};

function lessonNumber(name: string): number | null {
  const match = /^(\d{2})-/.exec(name);
  return match ? Number(match[1]) : null;
}

function lessonFiles(codeDir: string): string {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".py")) files.push(file);
    }
  };
  visit(codeDir);
  return files.map((file) => `# --- ${path.relative(codeDir, file)} ---\n${fs.readFileSync(file, "utf8")}`).join("\n\n");
}

function requiredModules(codeDir: string, lesson?: number): string[] {
  const known = ["torch", "numpy", "safetensors", "h5py", "zstandard", "yaml"];
  const source = lessonFiles(codeDir);
  const direct = known.filter((name) => new RegExp(`(^|\\n)\\s*(?:from|import)\\s+${name}(?:[.\\s]|$)`, "m").test(source));
  if (lesson === 57 || lesson === 75) direct.push("numpy");
  return [...new Set(direct)].sort();
}

function authorTestPath(codeDir: string): string | null {
  const roots = [codeDir, path.join(codeDir, "tests")].filter((dir) => fs.existsSync(dir));
  const candidates = roots.flatMap((dir) =>
    fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^tests?.*\.py$/.test(entry.name))
      .map((entry) => path.relative(codeDir, path.join(dir, entry.name))),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function isSpec(value: unknown, codeDir: string, number: number): value is LabExerciseSpec {
  if (!value || typeof value !== "object") return false;
  const spec = value as Partial<LabExerciseSpec>;
  if (spec.version !== 1 || !Array.isArray(spec.targets) || spec.targets.length < 4 || spec.targets.length > 5) return false;
  if ((spec.authorTest ? 1 : 0) + (spec.run ? 1 : 0) !== 1) return false;
  if (number >= 76 && number <= 81 && !spec.run) return false;
  if ((number < 76 || number > 81) && !spec.authorTest) return false;
  const symbols = new Map<string, Set<string>>();
  for (const target of spec.targets) {
    if (!target || typeof target.file !== "string" || typeof target.symbol !== "string" || typeof target.instruction !== "string") return false;
    const file = path.join(codeDir, target.file);
    if (!fs.existsSync(file)) return false;
    if (!symbols.has(target.file)) {
      symbols.set(target.file, new Set(parseExerciseTargets(fs.readFileSync(file, "utf8")).map((item) => item.symbol)));
    }
    if (!symbols.get(target.file)!.has(target.symbol)) return false;
    if (spec.authorTest && (!Array.isArray(target.tests) || target.tests.length === 0)) return false;
    if (spec.run && (target.tests?.length ?? 0) > 0) return false;
  }
  return true;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const deps = defaultDeps(config, { agent: args.agent });
  const phaseDir = path.join(config.sourceDir, "phases", PHASE);
  const dirs = fs.readdirSync(phaseDir)
    .filter((name) => {
      const number = lessonNumber(name);
      return number !== null && number >= args.from && number <= args.to;
    })
    .sort();
  const failed: string[] = [];

  for (const [index, name] of dirs.entries()) {
    const number = lessonNumber(name)!;
    const lessonDir = path.join(phaseDir, name);
    const codeDir = path.join(lessonDir, "code");
    const exerciseDir = path.join(config.sourceDir, "learning-exercises", `p19-l${name}`);
    const specPath = path.join(lessonDir, "lab.json");
    console.log(`[${index + 1}/${dirs.length}] ${name}`);

    if (!args.force && fs.existsSync(specPath) && fs.existsSync(exerciseDir)) {
      const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as LabExerciseSpec;
      spec.requirements = requiredModules(codeDir, number);
      spec.network = number === 42;
      if ((resourceMap[number]?.length ?? 0) > 0) spec.resources = resourceMap[number];
      fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
      const manifestPath = path.join(exerciseDir, "exercise.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      manifest.requirements = spec.requirements;
      manifest.network = spec.network;
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      console.log("  уже готово");
      continue;
    }

    let seed: LabExerciseSpec | null = null;
    if (fs.existsSync(specPath)) seed = JSON.parse(fs.readFileSync(specPath, "utf8")) as LabExerciseSpec;
    let lastError = "";
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      try {
        let spec = seed;
        if (!spec || args.force || attempt > 1) {
          const docs = fs.readFileSync(path.join(lessonDir, "docs", "en.md"), "utf8");
          const resources = resourceMap[number] ?? [];
          const prompt = renderPrompt("derive-lab", {
            lesson_title: name,
            source_text: docs,
            lab_code: lessonFiles(codeDir),
            resources_hint: resources.length > 0 ? JSON.stringify(resources, null, 2) : "(нет)",
          }) + (lastError ? `\n\nПредыдущая попытка не прошла проверку: ${lastError}\nИсправь спецификацию.` : "");
          const raw = await deps.run(prompt, () => {});
          const parsed = extractJsonBlock(raw);
          if (!isSpec(parsed, codeDir, number)) throw new Error("агент вернул некорректную спецификацию");
          spec = parsed;
          if ((resourceMap[number]?.length ?? 0) > 0) spec.resources = resourceMap[number];
        }
        if (!spec.run) {
          const authorTest = authorTestPath(codeDir);
          if (!authorTest) throw new Error("не удалось однозначно определить авторский pytest-файл");
          spec.authorTest = authorTest;
        }
        spec.requirements = requiredModules(codeDir, number);
        spec.network = number === 42;
        fs.rmSync(exerciseDir, { recursive: true, force: true });
        deriveLabExercise(codeDir, exerciseDir, spec);
        await verifyDerivedLabExercise(exerciseDir, spec, config.python);
        fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
        console.log(`  готово: ${spec.targets.length} целей`);
        lastError = "";
        break;
      } catch (error) {
        lastError = (error as Error).message;
        fs.rmSync(exerciseDir, { recursive: true, force: true });
        console.warn(`  попытка ${attempt}: ${lastError}`);
      }
    }
    if (lastError) failed.push(`${name}: ${lastError}`);
  }

  if (failed.length > 0) {
    console.error(`Не подготовлены:\n${failed.map((item) => `- ${item}`).join("\n")}`);
    process.exitCode = 1;
  }
}

await main();
