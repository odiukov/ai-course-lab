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
