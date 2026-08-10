import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { LessonRef } from "./catalog";
import { findExerciseDir, visualPrefixes } from "./naming";
import { parseTopLevelFunctions } from "./written-functions";

const quizSchema = z.object({
  questions: z.array(
    z.object({
      stage: z.string().default("post"),
      question: z.string(),
      options: z.array(z.string()),
      correct: z.number(),
      explanation: z.string().default(""),
    }),
  ),
});

export type QuizQuestion = z.infer<typeof quizSchema>["questions"][number];

export interface ExerciseInfo {
  slug: string;
  dir: string;
  functions: string[];
}

export interface LessonSource {
  ref: LessonRef;
  lang: "ru" | "en";
  textPath: string;
  text: string;
  sourceHash: string;
  quiz: QuizQuestion[];
  visuals: string[];
  exercise: ExerciseInfo | null;
}

function readText(courseRepo: string, ref: LessonRef): { lang: "ru" | "en"; rel: string } {
  const ru = path.join("i18n", "ru", "phases", ref.phaseDir, ref.lessonDir, "docs", "ru.md");
  if (fs.existsSync(path.join(courseRepo, ru))) return { lang: "ru", rel: ru };
  const en = path.join("phases", ref.phaseDir, ref.lessonDir, "docs", "en.md");
  return { lang: "en", rel: en };
}

function readQuiz(courseRepo: string, ref: LessonRef): QuizQuestion[] {
  const file = path.join(courseRepo, "phases", ref.phaseDir, ref.lessonDir, "quiz.json");
  if (!fs.existsSync(file)) return [];
  const parsed = quizSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  return parsed.success ? parsed.data.questions : [];
}

function readVisuals(courseRepo: string, ref: LessonRef): string[] {
  // Naming: new visualizations use the phase-qualified `pNN-lNN-*.html` form.
  // The unqualified legacy `lesson-NN-*.html` names don't encode a phase, so
  // they are honoured only for phase 1, where they were originally created
  // and where the lesson number alone is unambiguous.
  const dir = path.join(courseRepo, "learning-visuals");
  if (!fs.existsSync(dir)) return [];
  const prefixes = visualPrefixes(ref);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".html") && prefixes.some((prefix) => name.startsWith(prefix)))
    .sort()
    .map((name) => path.posix.join("learning-visuals", name));
}

function readExercise(courseRepo: string, ref: LessonRef): ExerciseInfo | null {
  const root = path.join(courseRepo, "learning-exercises");
  const found = findExerciseDir(root, ref);
  if (!found) return null;
  const dir = path.join(root, found);
  const template = path.join(dir, "exercise.template.py");
  if (!fs.existsSync(template)) return null;
  // Shares the balanced-paren header parser with the written-functions
  // registry. The old single-line regex here dropped every function whose
  // signature spans several lines, so the plan prompt never saw it and the
  // validator's coverage rule never demanded a step for it.
  const functions = parseTopLevelFunctions(fs.readFileSync(template, "utf8")).map(
    (block) => block.fn,
  );
  return { slug: found, dir, functions };
}

export function readLessonSource(courseRepo: string, ref: LessonRef): LessonSource {
  const { lang, rel } = readText(courseRepo, ref);
  const textPath = path.join(courseRepo, rel);
  const text = fs.readFileSync(textPath, "utf8");
  return {
    ref,
    lang,
    textPath,
    text,
    sourceHash: crypto.createHash("sha256").update(text).digest("hex"),
    quiz: readQuiz(courseRepo, ref),
    visuals: readVisuals(courseRepo, ref),
    exercise: readExercise(courseRepo, ref),
  };
}
