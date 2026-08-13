import fs from "node:fs";
import path from "node:path";

const lessonsDir = path.resolve(process.argv[2] ?? "content/lessons");

function filesIn(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .sort();
}

function proseOnly(markdown) {
  let fence = null;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^ {0,3}(```|~~~)/.exec(line)?.[1];
      if (marker) {
        fence = fence === marker ? null : fence ?? marker;
        return "";
      }
      if (fence) return "";
      return line.replace(/`+[^`\n]*`+/g, "");
    })
    .join("\n");
}

function auditReferences(markdown, stepNumber, total, lesson, problems, stats) {
  const prose = proseOnly(markdown);
  const linkedSpans = [];

  for (const match of prose.matchAll(/\[([^\]\n]+)\]\(#step-(\d+)\)/g)) {
    const target = Number(match[2]);
    linkedSpans.push([match.index, match.index + match[0].length]);
    stats.linkedReferences += 1;

    if (target < 1 || target > total) {
      problems.push(`${lesson} step ${stepNumber}: ссылка ведёт за пределы урока (#step-${target})`);
    } else if (target >= stepNumber) {
      problems.push(`${lesson} step ${stepNumber}: ссылка ведёт не назад (#step-${target})`);
    }

    if ((match[1].match(/\d+/g)?.length ?? 0) > 1) {
      problems.push(`${lesson} step ${stepNumber}: несколько номеров делят одну ссылку (${match[0]})`);
    }
  }

  const outsideLinkedSpan = (index) => !linkedSpans.some(([start, end]) => index >= start && index < end);
  for (const match of prose.matchAll(/(?<![\p{L}\p{N}_])шаг(?:е|а|у|ом|и|ов|ах)?\s+(\d+)/giu)) {
    if (!outsideLinkedSpan(match.index)) continue;

    // Локальная нумерация действий «**Шаг 1.**» — не переход по уроку.
    const before = prose.slice(Math.max(0, match.index - 2), match.index);
    const after = prose.slice(match.index + match[0].length);
    if (before === "**" && /^\.\*\*/.test(after)) continue;

    const target = Number(match[1]);
    // «шаг 0» у stride и «шаг 0.01» у оптимизатора — свойства алгоритма,
    // а не навигация по экранам. Очень большие номера обычно означают шаг
    // обучения («NaN на шаге 9001»). Явная #step-N ссылка проверяется всегда.
    if (target < 1 || target > total) continue;
    stats.legacyReferences += 1;
    if (target >= stepNumber) {
      problems.push(`${lesson} step ${stepNumber}: текстовая ссылка ведёт не назад (шаг ${target})`);
    }
  }
}

if (!fs.existsSync(lessonsDir)) {
  throw new Error(`Каталог уроков не найден: ${lessonsDir}`);
}

const problems = [];
const stats = {
  lessons: 0,
  complete: 0,
  inProgress: 0,
  notStarted: 0,
  plannedSteps: 0,
  writtenSteps: 0,
  visualSteps: 0,
  writtenVisuals: 0,
  linkedReferences: 0,
  legacyReferences: 0,
};

for (const entry of fs.readdirSync(lessonsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue;
  const lesson = entry.name;
  const lessonDir = path.join(lessonsDir, lesson);
  const planFile = path.join(lessonDir, "lesson.json");
  if (!fs.existsSync(planFile)) continue;

  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const expectedIds = new Set(steps.map((step) => step.id));
  const visualIds = new Set(steps.filter((step) => step.type === "visual").map((step) => step.id));
  const generatedVisualIds = new Set(
    steps.filter((step) => step.type === "visual" && !step.visual).map((step) => step.id),
  );
  const stepFiles = filesIn(path.join(lessonDir, "steps"), ".md");
  const visualFiles = filesIn(path.join(lessonDir, "visuals"), ".html");
  const writtenIds = new Set(stepFiles.map((name) => name.slice(0, -3)));
  const writtenVisualIds = new Set(visualFiles.map((name) => name.slice(0, -5)));

  stats.lessons += 1;
  stats.plannedSteps += steps.length;
  stats.writtenSteps += stepFiles.length;
  stats.visualSteps += visualIds.size;
  stats.writtenVisuals += visualFiles.length;

  if (stepFiles.length === 0) stats.notStarted += 1;
  else if (steps.every((step) => writtenIds.has(step.id))) stats.complete += 1;
  else stats.inProgress += 1;

  for (const file of stepFiles) {
    const id = file.slice(0, -3);
    if (!expectedIds.has(id)) problems.push(`${lesson}: лишний файл шага ${file}`);
  }

  for (const file of visualFiles) {
    const id = file.slice(0, -5);
    if (!generatedVisualIds.has(id)) problems.push(`${lesson}: лишний visual ${file}`);
    if (!writtenIds.has(id)) problems.push(`${lesson}: visual без созданного шага ${file}`);
  }

  const highestWrittenIndex = steps.reduce(
    (highest, step, index) => (writtenIds.has(step.id) ? Math.max(highest, index) : highest),
    -1,
  );

  for (let index = 0; index <= highestWrittenIndex; index += 1) {
    const step = steps[index];
    if (!writtenIds.has(step.id)) {
      problems.push(`${lesson}: дырка в последовательности — отсутствует ${step.id}.md перед созданными шагами`);
      continue;
    }

    if (generatedVisualIds.has(step.id) && !writtenVisualIds.has(step.id)) {
      problems.push(`${lesson}: для созданного visual-шага нет ${step.id}.html`);
    }

    const markdown = fs.readFileSync(path.join(lessonDir, "steps", `${step.id}.md`), "utf8");
    auditReferences(markdown, index + 1, steps.length, lesson, problems, stats);
  }
}

console.log(JSON.stringify(stats, null, 2));
if (problems.length > 0) {
  console.error(`\nНайдено проблем: ${problems.length}`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log("\nОшибок структуры и ссылок не найдено.");
}
