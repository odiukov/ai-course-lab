import path from "node:path";
import { resolveGeneratedVisualPath, resolveVisualPath } from "../api/visual-path";
import type { StepMeta } from "../content/step-file";

export interface VisualRef {
  /** Файл на диске, откуда схему брать. */
  sourcePath: string;
  /** Куда она ляжет внутри out/. */
  outRelPath: string;
  /** Каким адресом на неё сослаться со страницы урока. */
  href: string;
}

export interface CollectVisualRefsOptions {
  steps: StepMeta[];
  slug: string;
  contentDir: string;
  sourceDir: string;
  basePath: string;
}

/**
 * Какие схемы нужны уроку и куда они переезжают в статической сборке.
 *
 * Два пространства имён вместо одного, как и в /api/visual: пришедшие с курсом
 * схемы адресуются путём внутри source/, свои — парой урок+шаг. Проверки путей
 * те же самые, потому что источник тот же — поле в файле, который написала
 * модель.
 *
 * Схема, заявленная планом, но отсутствующая на диске, молча пропускается:
 * рамка на 404 даёт пустой прямоугольник в середине урока.
 */
export function collectVisualRefs(options: CollectVisualRefsOptions): {
  refs: VisualRef[];
  hrefByStepId: Record<string, string>;
} {
  const { steps, slug, contentDir, sourceDir, basePath } = options;
  const refs: VisualRef[] = [];
  const hrefByStepId: Record<string, string> = {};

  for (const step of steps) {
    let sourcePath: string | null = null;
    let outRelPath: string | null = null;

    if (step.visual) {
      const resolved = resolveVisualPath(sourceDir, step.visual);
      if (resolved.ok) {
        sourcePath = resolved.path;
        outRelPath = `visuals/course/${path.basename(resolved.path)}`;
      }
    } else if (step.visual_brief) {
      const resolved = resolveGeneratedVisualPath(contentDir, slug, step.id);
      if (resolved.ok) {
        sourcePath = resolved.path;
        outRelPath = `visuals/${slug}/${step.id}.html`;
      }
    }

    if (!sourcePath || !outRelPath) continue;

    const href = `${basePath}/${outRelPath}`;
    refs.push({ sourcePath, outRelPath, href });
    hrefByStepId[step.id] = href;
  }

  return { refs, hrefByStepId };
}
