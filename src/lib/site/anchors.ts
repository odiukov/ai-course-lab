export interface StepPageHrefOptions {
  basePath: string;
  slug: string;
  /** Порядок плана: по нему человеческий номер шага находит свой id. */
  stepIds: string[];
  /** Шаги, у которых есть своя страница. */
  writtenIds: string[];
}

/** Адрес страницы шага. */
export function stepPageUrl(basePath: string, slug: string, stepId: string): string {
  return `${basePath}/lesson/${slug}/${stepId}/`;
}

/** Адрес оглавления урока. */
export function lessonUrl(basePath: string, slug: string): string {
  return `${basePath}/lesson/${slug}/`;
}

/**
 * Переводчик «номер шага в тексте → адрес страницы этого шага».
 *
 * Ссылка на шаг, которого ещё нет на диске, ведёт на оглавление урока, а не
 * на несуществующую страницу: 404 посреди чтения хуже, чем список, где видно,
 * что этот шаг ещё не написан. Туда же ведёт номер вне плана.
 */
export function stepPageHref(options: StepPageHrefOptions): (stepNumber: number) => string {
  const written = new Set(options.writtenIds);

  return (stepNumber) => {
    const id = options.stepIds[stepNumber - 1];
    return id && written.has(id)
      ? stepPageUrl(options.basePath, options.slug, id)
      : lessonUrl(options.basePath, options.slug);
  };
}
