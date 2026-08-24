import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/lib/config";
import { readLessonPlan } from "../src/lib/content/lesson-plan";
import { readPhase19Tracks } from "../src/lib/content/phase-19-tracks";
import { readProject } from "../src/lib/content/project";
import { readProjectContract } from "../src/lib/exercise/project-contract";

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function numberedDirs(root: string, predicate: (number: number) => boolean): string[] {
  return fs.readdirSync(root)
    .filter((name) => /^\d{2}-/.test(name) && predicate(Number(name.slice(0, 2))))
    .sort();
}

const config = loadConfig();
const phaseRoot = path.join(config.sourceDir, "phases", "19-capstone-projects");
const labs = numberedDirs(phaseRoot, (number) => number >= 20);
const capstones = numberedDirs(phaseRoot, (number) => number <= 17);
invariant(labs.length === 68, `Ожидалось 68 лабораторий, найдено ${labs.length}`);
invariant(capstones.length === 17, `Ожидалось 17 капстоунов, найдено ${capstones.length}`);

const tracks = readPhase19Tracks(config.contentDir);
const trackedLabs = tracks.flatMap((track) => track.labs);
invariant(new Set(trackedLabs).size === trackedLabs.length, "Одна лаборатория указана в нескольких треках");
invariant(
  labs.every((name) => trackedLabs.includes(name)) && trackedLabs.length === labs.length,
  "Треки не покрывают ровно все лаборатории 20–87",
);

let lessonSteps = 0;
let exerciseTargets = 0;
for (const name of labs) {
  const slug = `19-capstone-projects__${name}`;
  const sourceManifest = path.join(phaseRoot, name, "lab.json");
  const exerciseDir = path.join(config.sourceDir, "learning-exercises", `p19-l${name}`);
  const exerciseManifest = path.join(exerciseDir, "exercise.json");
  invariant(fs.existsSync(sourceManifest), `${name}: нет lab.json`);
  invariant(fs.existsSync(exerciseManifest), `${name}: нет exercise.json`);
  const manifest = JSON.parse(fs.readFileSync(exerciseManifest, "utf8")) as { targets?: unknown[] };
  invariant(Array.isArray(manifest.targets) && manifest.targets.length >= 4 && manifest.targets.length <= 8,
    `${name}: нужно 4–8 целей упражнения`);
  exerciseTargets += manifest.targets.length;

  const plan = readLessonPlan(config.contentDir, slug);
  invariant(plan, `${name}: нет lesson.json`);
  invariant(plan.steps.length >= 8 && plan.steps.length <= 12, `${name}: план должен содержать 8–12 шагов`);
  const stepsDir = path.join(config.contentDir, "lessons", slug, "steps");
  const written = fs.existsSync(stepsDir) ? fs.readdirSync(stepsDir).filter((file) => file.endsWith(".md")) : [];
  invariant(written.length === plan.steps.length, `${name}: написано ${written.length} из ${plan.steps.length} шагов`);
  lessonSteps += written.length;
}

let milestones = 0;
let contractTargets = 0;
for (const name of capstones) {
  const slug = `19-capstone-projects__${name}`;
  const project = readProject(config.contentDir, slug);
  invariant(project, `${name}: нет project.json`);
  for (const milestone of project.milestones) {
    invariant(
      fs.existsSync(path.join(config.contentDir, "projects", slug, "milestones", `${milestone.id}.md`)),
      `${name}/${milestone.id}: нет текста milestone`,
    );
    if (milestone.contractTargets.length > 0) {
      const contract = readProjectContract(config.sourceDir, slug, milestone.id);
      invariant(contract, `${name}/${milestone.id}: нет контракта`);
      invariant(
        contract.targets.map((target) => target.symbol).join("\0") === milestone.contractTargets.join("\0"),
        `${name}/${milestone.id}: цели контракта не совпадают с project.json`,
      );
    }
    contractTargets += milestone.contractTargets.length;
  }
  milestones += project.milestones.length;
  const contracts = path.join(config.sourceDir, "learning-projects", `p19-c${name}`, "project.json");
  invariant(fs.existsSync(contracts), `${name}: нет принятых контрактов`);
}

console.log(
  `Фаза 19 цела: ${tracks.length} треков, ${labs.length} лабораторий, ` +
  `${lessonSteps} шагов, ${exerciseTargets} целей, ${capstones.length} капстоунов, ` +
  `${milestones} milestones, ${contractTargets} контрактных швов.`,
);
