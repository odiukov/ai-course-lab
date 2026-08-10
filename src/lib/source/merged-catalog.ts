import { readCatalog, type LessonRef, type PhaseRef } from "./catalog";

export interface CatalogLesson extends LessonRef {
  imported: boolean;
}

export interface CatalogPhase {
  dir: string;
  number: number;
  title: string;
  lessons: CatalogLesson[];
}

export function readMergedCatalog(sourceDir: string, courseRepo: string | null): CatalogPhase[] {
  const imported = readCatalog(sourceDir);
  const importedSlugs = new Set(imported.flatMap((phase) => phase.lessons).map((l) => l.slug));

  const phases = new Map<string, CatalogPhase>();
  const add = (source: PhaseRef[]) => {
    for (const phase of source) {
      const existing = phases.get(phase.dir) ?? {
        dir: phase.dir,
        number: phase.number,
        title: phase.title,
        lessons: [],
      };
      for (const lesson of phase.lessons) {
        if (existing.lessons.some((l) => l.slug === lesson.slug)) continue;
        existing.lessons.push({ ...lesson, imported: importedSlugs.has(lesson.slug) });
      }
      phases.set(phase.dir, existing);
    }
  };

  add(imported);
  if (courseRepo) add(readCatalog(courseRepo));

  return [...phases.values()]
    .sort((a, b) => a.number - b.number)
    .map((phase) => ({
      ...phase,
      lessons: [...phase.lessons].sort((a, b) => a.lessonNumber - b.lessonNumber),
    }));
}
