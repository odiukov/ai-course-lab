import fs from "node:fs";
import path from "node:path";
import { readLessonClarifications, type Clarification } from "../content/clarifications";
import { readLessonPlan } from "../content/lesson-plan";
import { lessonPaths } from "../content/paths";
import { readStep, type StepType } from "../content/step-file";
import { readExerciseTree } from "../exercise/tree";
import { resolveVisualPath } from "../api/visual-path";
import type { Config } from "../config";
import { readMergedCatalog } from "../source/merged-catalog";

const BOOK_STEP_TYPES = new Set<StepType>(["theory", "visual"]);
const PRACTICE_STEP_TYPES = new Set<StepType>(["code", "run"]);

export interface BookSection {
  id: string;
  number: number;
  title: string;
  body: string;
  clarifications: Clarification[];
  visualHtml: string | null;
}

export interface BookSolution {
  name: string;
  code: string;
}

export interface BookLesson {
  slug: string;
  number: number;
  title: string;
  sections: BookSection[];
  solutions: BookSolution[];
}

export interface BookModel {
  phaseNumber: number;
  phaseTitle: string;
  lessons: BookLesson[];
  generatedAt: Date;
}

export function availableBookPhases(config: Config): number[] {
  return readMergedCatalog(config.sourceDir, config.courseRepo)
    .filter((phase) =>
      phase.lessons.some(
        (lesson) => lesson.imported && readLessonPlan(config.contentDir, lesson.slug) !== null,
      ),
    )
    .map((phase) => phase.number);
}

function readVisualHtml(
  config: Config,
  slug: string,
  step: { id: string; visual?: string; visual_brief?: string },
): string | null {
  const generated = lessonPaths(config.contentDir, slug).visualFile(step.id);
  if (step.visual_brief && fs.existsSync(generated)) {
    return visualForPrint(fs.readFileSync(generated, "utf8"));
  }
  if (!step.visual) return null;
  const resolved = resolveVisualPath(config.sourceDir, step.visual);
  return resolved.ok ? visualForPrint(fs.readFileSync(resolved.path, "utf8")) : null;
}

// Visuals often build their SVG from inline data. Let that local script run,
// but give the srcdoc its own CSP so a generated diagram cannot reach the
// network while the book is being printed.
function visualForPrint(html: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">`;
  return /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, (head) => `${head}${csp}`)
    : `${csp}${html}`;
}

function readSolutions(config: Config, lesson: Parameters<typeof readExerciseTree>[1]): BookSolution[] {
  const tree = readExerciseTree(config.sourceDir, lesson);
  if (!tree) return [];

  return tree.files.flatMap((file) => {
    if (!file.solutionPath || !fs.existsSync(file.solutionPath)) return [];
    return [{ name: file.name, code: fs.readFileSync(file.solutionPath, "utf8").trimEnd() }];
  });
}

/**
 * Builds a print model from disk on every call.
 *
 * The book deliberately contains no check, quiz, or recall steps. Coding and
 * run steps are also omitted as exercises; when a lesson has either, its
 * canonical solution files are appended once as a finished implementation.
 */
export function buildPhaseBook(config: Config, phaseNumber: number): BookModel | null {
  const phase = readMergedCatalog(config.sourceDir, config.courseRepo).find(
    (item) => item.number === phaseNumber,
  );
  if (!phase) return null;

  const lessons: BookLesson[] = [];
  for (const lesson of phase.lessons) {
    if (!lesson.imported) continue;
    const plan = readLessonPlan(config.contentDir, lesson.slug);
    if (!plan) continue;

    const clarifications = readLessonClarifications(config.contentDir, lesson.slug);
    const sections: BookSection[] = [];
    let hasPractice = false;

    plan.steps.forEach((meta, index) => {
      if (PRACTICE_STEP_TYPES.has(meta.type)) hasPractice = true;
      if (!BOOK_STEP_TYPES.has(meta.type)) return;
      const step = readStep(config.contentDir, lesson.slug, meta.id);
      if (!step) return;
      sections.push({
        id: step.id,
        number: index + 1,
        title: step.title,
        body: step.body,
        clarifications: clarifications.get(step.id) ?? [],
        visualHtml: step.type === "visual" ? readVisualHtml(config, lesson.slug, step) : null,
      });
    });

    if (sections.length === 0) continue;
    lessons.push({
      slug: lesson.slug,
      number: lesson.lessonNumber,
      title: plan.title,
      sections,
      solutions: hasPractice ? readSolutions(config, lesson) : [],
    });
  }

  return {
    phaseNumber: phase.number,
    phaseTitle: phase.title,
    lessons,
    generatedAt: new Date(),
  };
}

export function bookFilename(phaseNumber: number | null): string {
  return phaseNumber === null
    ? "ai-engineering-complete.pdf"
    : `ai-engineering-phase-${String(phaseNumber).padStart(2, "0")}.pdf`;
}

export function resolveChromeExecutable(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const candidates = [
    env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => fs.existsSync(path.resolve(candidate))) ?? null;
}
