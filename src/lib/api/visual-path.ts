import fs from "node:fs";
import path from "node:path";
import { lessonPaths, SAFE_SEGMENT } from "../content/paths";

export type VisualPathResolution =
  | { ok: true; path: string }
  | { ok: false; reason: "forbidden" | "not-found" };

function isContained(root: string, target: string): boolean {
  return target.startsWith(`${root}${path.sep}`);
}

// Resolves `rel` against `sourceDir` and confirms the result stays inside
// `<sourceDir>/learning-visuals` and ends in `.html`.
//
// The lexical check (string-prefix containment on the resolved path) alone
// blocks `../` traversal, absolute paths, and a sibling directory like
// `learning-visuals-evil` — but not a symlink sitting *inside*
// learning-visuals/ that points somewhere else on disk: fs.existsSync and
// fs.readFileSync both follow symlinks, so the lexical check alone would
// let such a link serve arbitrary file contents. Once the file is confirmed
// to exist, both the root and the target are resolved through
// fs.realpathSync (which follows symlinks) and the same containment check
// is re-applied to the canonical paths. The root is canonicalized too, so
// the check still holds if the project directory itself is reached through
// a symlinked path.
//
// The `.html` requirement and the "it's a regular file" requirement are
// re-checked against the *canonical* path too, not just the requested one:
// a `something.html` symlink inside learning-visuals/ can resolve to a
// non-HTML file (still inside the tree, so the containment re-check alone
// wouldn't catch it) or to a directory (which would make fs.readFileSync
// throw EISDIR instead of cleanly rejecting).
export function resolveVisualPath(sourceDir: string, rel: string): VisualPathResolution {
  const root = path.join(sourceDir, "learning-visuals");
  const target = path.resolve(sourceDir, rel);

  if (!isContained(root, target) || !target.endsWith(".html")) {
    return { ok: false, reason: "forbidden" };
  }
  if (!fs.existsSync(target)) {
    return { ok: false, reason: "not-found" };
  }

  const canonicalRoot = fs.realpathSync(root);
  const canonicalTarget = fs.realpathSync(target);
  if (
    !isContained(canonicalRoot, canonicalTarget) ||
    !canonicalTarget.endsWith(".html") ||
    !fs.statSync(canonicalTarget).isFile()
  ) {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, path: canonicalTarget };
}

/**
 * То же, что resolveVisualPath, но для схем, которые проект нарисовал сам:
 * они лежат в `<contentDir>/lessons/<slug>/visuals/<stepId>.html`.
 *
 * Проверки повторяются полностью, а не сокращаются на «путь же собран нами»:
 * симлинк внутри visuals/ ведёт куда угодно, а fs.readFileSync его пройдёт.
 * Поэтому после existsSync оба конца канонизируются через realpathSync, и
 * containment, расширение и «это обычный файл» перепроверяются на
 * канонических путях.
 */
export function resolveGeneratedVisualPath(
  contentDir: string,
  slug: string,
  stepId: string,
): VisualPathResolution {
  if (!SAFE_SEGMENT.test(slug) || !SAFE_SEGMENT.test(stepId)) {
    return { ok: false, reason: "forbidden" };
  }

  const paths = lessonPaths(contentDir, slug);
  const root = paths.visualsDir;
  const target = paths.visualFile(stepId);

  if (!isContained(root, target) || !target.endsWith(".html")) {
    return { ok: false, reason: "forbidden" };
  }
  if (!fs.existsSync(target)) {
    return { ok: false, reason: "not-found" };
  }

  const canonicalRoot = fs.realpathSync(root);
  const canonicalTarget = fs.realpathSync(target);
  if (
    !isContained(canonicalRoot, canonicalTarget) ||
    !canonicalTarget.endsWith(".html") ||
    !fs.statSync(canonicalTarget).isFile()
  ) {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, path: canonicalTarget };
}
