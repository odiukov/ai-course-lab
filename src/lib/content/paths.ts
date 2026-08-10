import path from "node:path";

export interface LessonPaths {
  dir: string;
  planFile: string;
  stepsDir: string;
  clarificationsDir: string;
  visualsDir: string;
  stepFile(id: string): string;
  clarificationFile(id: string): string;
  visualFile(id: string): string;
}

/**
 * A path as it should be stored in a committed file: relative to the repo
 * root and with forward slashes. lesson.json is in git, so an absolute path
 * would leak the author's machine layout and go stale on any other checkout.
 * A path outside the repo is left absolute rather than turned into a ../..
 * chain that means nothing to a reader.
 */
export function repoRelative(target: string, root: string = process.cwd()): string {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return target;
  return rel.split(path.sep).join("/");
}

export function lessonPaths(contentDir: string, slug: string): LessonPaths {
  const dir = path.join(contentDir, "lessons", slug);
  const stepsDir = path.join(dir, "steps");
  const clarificationsDir = path.join(dir, "clarifications");
  const visualsDir = path.join(dir, "visuals");
  return {
    dir,
    planFile: path.join(dir, "lesson.json"),
    stepsDir,
    clarificationsDir,
    visualsDir,
    stepFile: (id) => path.join(stepsDir, `${id}.md`),
    clarificationFile: (id) => path.join(clarificationsDir, `${id}.md`),
    visualFile: (id) => path.join(visualsDir, `${id}.html`),
  };
}
