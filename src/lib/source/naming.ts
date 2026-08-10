import fs from "node:fs";
import path from "node:path";
import type { LessonRef } from "./catalog";

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Prefixes that identify a lesson's `learning-visuals/*.html` files.
 *
 * The current naming scheme is phase-qualified: `pPP-lNN-*.html`, unambiguous
 * across the whole course. Phase 1 additionally carries legacy files named
 * only `lesson-NN-*.html`, from before the scheme existed — those names don't
 * encode a phase, so honouring them outside phase 1 would risk matching a
 * different phase's same-numbered lesson.
 */
export function visualPrefixes(ref: LessonRef): string[] {
  const prefixes = [`p${pad2(ref.phaseNumber)}-l${pad2(ref.lessonNumber)}-`];
  if (ref.phaseNumber === 1) {
    prefixes.push(`lesson-${pad2(ref.lessonNumber)}-`);
  }
  return prefixes;
}

/** The `pPP-lNN-` prefix of a lesson's `learning-exercises/<slug>/` directory. */
export function exercisePrefix(ref: Pick<LessonRef, "phaseNumber" | "lessonNumber">): string {
  return `p${pad2(ref.phaseNumber)}-l${pad2(ref.lessonNumber)}-`;
}

const EXERCISE_SLUG = /^p(\d{2})-l(\d{2})-/;

/** The inverse of exercisePrefix: reads phase and lesson numbers off a slug. */
export function parseExerciseSlug(
  exerciseSlug: string,
): { phaseNumber: number; lessonNumber: number } | null {
  const match = EXERCISE_SLUG.exec(exerciseSlug);
  if (!match) return null;
  return { phaseNumber: Number(match[1]), lessonNumber: Number(match[2]) };
}

/**
 * The single exercise directory of a lesson, or null if the lesson has none.
 *
 * Throws when more than one directory carries the prefix. Guessing here would
 * be silent and wrong in both directions: the reader would show one lesson's
 * functions while the importer copied another's.
 */
export function findExerciseDir(exercisesRoot: string, ref: LessonRef): string | null {
  if (!fs.existsSync(exercisesRoot)) return null;
  const prefix = exercisePrefix(ref);
  const candidates = fs
    .readdirSync(exercisesRoot)
    .filter((name) => name.startsWith(prefix))
    .filter((name) => fs.statSync(path.join(exercisesRoot, name)).isDirectory());
  if (candidates.length > 1) {
    throw new Error(
      `Неоднозначное совпадение упражнения для ${ref.slug}: ${candidates.join(", ")}`,
    );
  }
  return candidates[0] ?? null;
}
