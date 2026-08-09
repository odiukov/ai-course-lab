import path from "node:path";

export interface LessonPaths {
  dir: string;
  planFile: string;
  stepsDir: string;
  clarificationsDir: string;
  stepFile(id: string): string;
  clarificationFile(id: string): string;
}

export function lessonPaths(contentDir: string, slug: string): LessonPaths {
  const dir = path.join(contentDir, "lessons", slug);
  const stepsDir = path.join(dir, "steps");
  const clarificationsDir = path.join(dir, "clarifications");
  return {
    dir,
    planFile: path.join(dir, "lesson.json"),
    stepsDir,
    clarificationsDir,
    stepFile: (id) => path.join(stepsDir, `${id}.md`),
    clarificationFile: (id) => path.join(clarificationsDir, `${id}.md`),
  };
}
