import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { LessonRef } from "./catalog";

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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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
  // Limitation: visualization file names do not encode the phase number,
  // so matching by lesson number is only reliable within the first phase.
  const dir = path.join(courseRepo, "learning-visuals");
  if (!fs.existsSync(dir)) return [];
  const prefix = `lesson-${pad2(ref.lessonNumber)}-`;
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".html"))
    .sort()
    .map((name) => path.posix.join("learning-visuals", name));
}

function readExercise(courseRepo: string, ref: LessonRef): ExerciseInfo | null {
  const root = path.join(courseRepo, "learning-exercises");
  if (!fs.existsSync(root)) return null;
  const prefix = `p${pad2(ref.phaseNumber)}-l${pad2(ref.lessonNumber)}-`;
  const found = fs.readdirSync(root).find((name) => name.startsWith(prefix));
  if (!found) return null;
  const dir = path.join(root, found);
  const template = path.join(dir, "exercise.template.py");
  if (!fs.existsSync(template)) return null;
  const functions = [...fs.readFileSync(template, "utf8").matchAll(/^def ([a-z][a-z0-9_]*)\(/gm)]
    .map((match) => match[1]);
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
