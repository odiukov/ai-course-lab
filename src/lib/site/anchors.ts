/** Якорь шага на странице урока. */
export function stepAnchor(stepId: string): string {
  return `step-${stepId}`;
}

/**
 * Переводчик «номер шага в тексте → якорь на этой же странице».
 *
 * Номера в markdown человеческие, с единицы, а `stepIds` — порядок плана.
 * Номер вне плана отдаётся как есть: такая ссылка не ведёт никуда и в
 * приложении, но текст вокруг неё должен остаться целым.
 */
export function anchorHrefForStep(stepIds: string[]): (stepNumber: number) => string {
  return (stepNumber) => {
    const id = stepIds[stepNumber - 1];
    return id ? `#${stepAnchor(id)}` : `#step-${stepNumber}`;
  };
}
