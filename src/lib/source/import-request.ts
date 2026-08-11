import { effectiveCourseRepo, type Config } from "@/lib/config";
import { findLesson } from "./catalog";
import { importLesson, isImported } from "./import-lesson";
import { ensureUpstream, type UpstreamOptions, type UpstreamResult } from "./upstream";

/**
 * Сколько кэш апстрима считается свежим.
 *
 * Пять минут выбраны так, чтобы серия импортов подряд («завести четыре
 * урока») стоила одного обращения к сети, а возврат к каталогу через полчаса
 * гарантированно принёс свежий курс.
 */
export const UPSTREAM_MAX_AGE_MS = 5 * 60_000;

export interface ImportOutcome {
  slug: string;
  mode: "import" | "reimport";
  pull: { fetched: boolean; head: string | null; at: number | null; error?: string };
  copied: number;
  updated: number;
  kept: number;
}

export interface ImportFailure {
  status: number;
  error: string;
}

export type ImportRequestResult = ImportOutcome | ImportFailure;

export interface ImportDeps {
  ensure?: (options: UpstreamOptions) => UpstreamResult;
}

export function runImport(config: Config, slug: string, deps: ImportDeps = {}): ImportRequestResult {
  const ensure = deps.ensure ?? ensureUpstream;

  let repo = config.courseRepo;
  let pull: ImportOutcome["pull"] = { fetched: false, head: null, at: null };

  try {
    const upstream = ensure({
      dir: config.upstreamDir,
      remote: config.upstreamRemote,
      branch: config.upstreamBranch,
      maxAgeMs: UPSTREAM_MAX_AGE_MS,
    });
    // Клон может пройти без ошибок и всё же не дать курс: не тот UPSTREAM_BRANCH,
    // переструктуренный апстрим — тем же правилом, что и loadConfig, проверяем
    // наличие phases/, иначе падаем на COURSE_REPO.
    repo = effectiveCourseRepo(upstream.dir, config.localCourseRepo);
    pull = { fetched: upstream.fetched, head: upstream.head, at: upstream.fetchedAt, error: upstream.error };
  } catch (error) {
    // Апстрим не развернулся. Если локальный курс есть — импортируем из него
    // и говорим об этом; кнопка не обязана падать из-за отсутствия сети.
    pull = { ...pull, error: (error as Error).message };
  }

  if (!repo) {
    const reason = pull.error ? `: ${pull.error}` : "";
    return { status: 503, error: `Курс недоступен: нет ни кэша апстрима, ни COURSE_REPO${reason}` };
  }

  const ref = findLesson(repo, slug);
  if (!ref) return { status: 404, error: "Урок не найден" };

  // Считается ДО импорта: после него isImported всегда true, и режим у
  // первого импорта оказался бы «реимпорт».
  const overwrite = isImported(config.sourceDir, ref);

  // Оба репозитория, а не один. Тексты и переводы приезжают из апстрима, но
  // learning-exercises/ и learning-visuals/ есть только в форке — в
  // рут-репозитории таких каталогов нет вовсе. Импорт из одного апстрима
  // молча оставлял урок без упражнения, а планировщик тогда получал
  // «(нет упражнения)» и строил урок вообще без code-шагов.
  const result = importLesson(
    [repo, config.localCourseRepo].filter((item): item is string => item !== null),
    config.sourceDir,
    ref,
    { overwrite },
  );

  return {
    slug,
    mode: overwrite ? "reimport" : "import",
    pull,
    copied: result.copied.length,
    updated: result.updated.length,
    kept: result.kept.length,
  };
}
