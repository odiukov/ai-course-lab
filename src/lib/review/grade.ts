import type { Grade } from "./scheduler";

/**
 * Автопроверяемая карточка: верно — «хорошо», неверно — «снова».
 *
 * Промежуточных оценок здесь нет намеренно: машина знает только факт
 * попадания, а «с трудом» — это про ощущение человека, которого она не видит.
 */
export function gradeAuto(correct: boolean): Grade {
  return correct ? "good" : "again";
}

/** Кнопки самооценки у карточки «объясни своими словами». */
export type SelfGrade = "again" | "hard" | "easy";

/**
 * `good` человеку недоступна намеренно: три кнопки различимы на глаз,
 * четыре превращаются в гадание.
 */
export function gradeSelf(choice: SelfGrade): Grade {
  return choice;
}
