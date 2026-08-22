import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { canonicalFunctions, readExerciseTree } from "../exercise/tree";
import type { ExerciseRunRef } from "../exercise/tree";
import type { LessonRef } from "./catalog";
import { visualPrefixes } from "./naming";

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
  /** Каталожная форма (`exercise.template/`) против одно-файловой. */
  multi: boolean;
  functions: { file: string; fn: string }[];
  run?: ExerciseRunRef;
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
  const tree = readExerciseTree(courseRepo, ref);
  if (!tree) return null;
  return {
    slug: tree.slug,
    dir: tree.dir,
    multi: tree.multi,
    functions: canonicalFunctions(tree),
    ...(tree.run ? { run: tree.run } : {}),
  };
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
