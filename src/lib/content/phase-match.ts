/**
 * Номер фазы, зашитый в начало слага урока.
 *
 * Слаг всегда хранит номер фазы дополненным нулём (01-math-foundations__02-...),
 * поэтому первые две цифры перед дефисом и есть номер.
 */
const PHASE_PREFIX = /^(\d{2})-/;

export function lessonPhaseNumber(slug: string): number | null {
  const match = PHASE_PREFIX.exec(slug);
  return match ? Number(match[1]) : null;
}

/**
 * Совпадает ли слаг урока с фазой, заданной аргументом `--phase`.
 *
 * `--phase 1` и `--phase 01` должны находить один и тот же набор уроков:
 * человек каждый раз набирает номер заново, а слаг на диске хранит только
 * дополненную нулём форму. write-cards.mts сравнивал номер как число (через
 * readCatalog), а audit-cards.mts — слаг как строку (`startsWith`), и ворота
 * между фазами читали «--phase 1» как несуществующую фазу и тихо отчитывались
 * об успехе на пустом множестве. Сравнение здесь идёт по числу для обеих
 * сторон, а не по подстроке.
 */
export function matchesPhase(slug: string, phase: string): boolean {
  const number = Number(phase);
  if (!Number.isInteger(number)) return false;
  return lessonPhaseNumber(slug) === number;
}
