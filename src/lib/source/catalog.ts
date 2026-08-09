import fs from "node:fs";
import path from "node:path";

export interface LessonRef {
  slug: string;
  phaseDir: string;
  lessonDir: string;
  phaseNumber: number;
  lessonNumber: number;
  title: string;
}

export interface PhaseRef {
  dir: string;
  number: number;
  title: string;
  lessons: LessonRef[];
}

const NUMBERED = /^(\d{2})-(.+)$/;

function humanize(rest: string): string {
  return rest
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function listNumbered(dir: string): { name: string; number: number; rest: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ entry, match: NUMBERED.exec(entry.name) }))
    .filter((x): x is { entry: fs.Dirent; match: RegExpExecArray } => x.match !== null)
    .map(({ entry, match }) => ({
      name: entry.name,
      number: Number(match[1]),
      rest: match[2],
    }))
    .sort((a, b) => a.number - b.number);
}

export function readCatalog(courseRepo: string): PhaseRef[] {
  const phasesRoot = path.join(courseRepo, "phases");
  return listNumbered(phasesRoot).map((phase) => {
    const phaseDirAbs = path.join(phasesRoot, phase.name);
    const lessons = listNumbered(phaseDirAbs)
      .filter((lesson) => fs.existsSync(path.join(phaseDirAbs, lesson.name, "docs")))
      .map((lesson) => ({
        slug: `${phase.name}__${lesson.name}`,
        phaseDir: phase.name,
        lessonDir: lesson.name,
        phaseNumber: phase.number,
        lessonNumber: lesson.number,
        title: humanize(lesson.rest),
      }));
    return {
      dir: phase.name,
      number: phase.number,
      title: humanize(phase.rest),
      lessons,
    };
  });
}

export function findLesson(courseRepo: string, slug: string): LessonRef | null {
  for (const phase of readCatalog(courseRepo)) {
    const found = phase.lessons.find((lesson) => lesson.slug === slug);
    if (found) return found;
  }
  return null;
}
