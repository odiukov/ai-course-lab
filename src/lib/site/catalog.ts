export interface CatalogLesson {
  slug: string;
  title: string;
  /** Номер урока внутри фазы. */
  number: number;
  writtenCount: number;
  plannedCount: number;
}

export interface CatalogPhase {
  number: number;
  title: string;
  lessons: CatalogLesson[];
}

const SLUG = /^(\d{2})-([^_]+)__(\d{2})-(.+)$/;

function humanize(rest: string): string {
  return rest
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Раскладывает уроки по фазам, читая номер и название фазы из слага.
 *
 * Слаг — единственный источник: `readCatalog` ходит в репозиторий курса,
 * которого у сборки статики может не быть вовсе, а `content/lessons`
 * самодостаточен.
 */
export function groupLessons(lessons: CatalogLesson[]): CatalogPhase[] {
  const phases = new Map<number, CatalogPhase>();

  for (const lesson of lessons) {
    const match = SLUG.exec(lesson.slug);
    if (!match) continue;

    const number = Number(match[1]);
    const phase = phases.get(number) ?? { number, title: humanize(match[2]), lessons: [] };
    phase.lessons.push(lesson);
    phases.set(number, phase);
  }

  return [...phases.values()]
    .sort((a, b) => a.number - b.number)
    .map((phase) => ({
      ...phase,
      lessons: [...phase.lessons].sort((a, b) => a.number - b.number),
    }));
}
