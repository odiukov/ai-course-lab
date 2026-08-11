import Link from "next/link";
import { loadConfig } from "@/lib/config";
import { hasClone } from "@/lib/source/upstream";
import { readMergedCatalog } from "@/lib/source/merged-catalog";
import { readLessonPlan } from "@/lib/content/lesson-plan";
import { plural, since } from "@/lib/content/since";
import { diffLesson } from "@/lib/source/import-lesson";
import { openProgressDb } from "@/lib/progress/db";
import { readImportDates } from "@/lib/progress/imports";
import { readLessonReadCounts } from "@/lib/progress/steps";
import { AgentPicker } from "@/components/AgentPicker";
import ImportButton from "@/components/ImportButton";

export const dynamic = "force-dynamic";

export default function CatalogPage() {
  const config = loadConfig();
  const phases = readMergedCatalog(config.sourceDir, config.courseRepo);
  // Каталог — серверный компонент, поэтому читает базу напрямую: один запрос на
  // всю страницу вместо эндпоинта и похода за каждой строкой.
  const db = openProgressDb(config.dataDir);
  const readCounts = readLessonReadCounts(db);
  const importDates = readImportDates(db);
  // Первый клик без кэша клонирует курс целиком — кнопке нужно сказать об
  // этом словами, иначе долгое молчание читается как зависание.
  const firstRun = !hasClone(config.upstreamDir);

  return (
    <main className="mx-auto max-w-3xl">
      <div className="mb-8 flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold">Курс</h1>
        <AgentPicker />
      </div>
      {phases.map((phase) => (
        <section key={phase.dir} className="mb-8">
          <h2 className="mb-3 text-lg font-medium text-slate-500 dark:text-slate-400">
            Фаза {phase.number}. {phase.title}
          </h2>
          <ul className="space-y-1">
            {phase.lessons.map((lesson) => {
              const plan = lesson.imported
                ? readLessonPlan(config.contentDir, lesson.slug)
                : null;

              if (!lesson.imported) {
                return (
                  <li
                    key={lesson.slug}
                    className="flex items-baseline gap-2 px-2 py-1 text-slate-500 dark:text-slate-400"
                  >
                    <span className="tabular-nums">{lesson.lessonNumber}</span>
                    <span>{lesson.title}</span>
                    {/* Один и тот же key в обеих ветках строки — чтобы после router.refresh()
                        React переиспользовал ту же кнопку, а не размонтировал её вместе со
                        сводкой «+N новых». */}
                    <ImportButton
                      key="import"
                      slug={lesson.slug}
                      imported={false}
                      hasPlan={false}
                      firstRun={firstRun}
                    />
                  </li>
                );
              }

              // Насколько урок отстал от курса: сравнение содержимого, а не
              // даты коммита. Кэш апстрима — shallow-клон в один коммит, и
              // «когда трогали папку урока» из него не достать; к тому же
              // ответ по файлам учитывает и правки, сделанные в source/ руками.
              const diff = config.courseRepo
                ? diffLesson(config.courseRepo, config.sourceDir, lesson)
                : { added: 0, changed: 0 };
              const behind = diff.added + diff.changed;
              const importedAt = importDates.get(lesson.slug);

              return (
                <li key={lesson.slug} className="flex items-baseline gap-2 pr-2">
                  <Link
                    href={`/lesson/${lesson.slug}`}
                    className="flex flex-1 items-baseline gap-2 rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="tabular-nums text-slate-500 dark:text-slate-400">{lesson.lessonNumber}</span>
                    <span>{lesson.title}</span>
                    <span className="ml-auto flex items-baseline gap-3 text-xs">
                      {behind > 0 && (
                        <span className="text-amber-600 dark:text-amber-400">
                          обновится {behind} {plural(behind, "файл", "файла", "файлов")}
                        </span>
                      )}
                      {importedAt && (
                        <span className="text-slate-400 dark:text-slate-500">
                          импортирован {since(importedAt)}
                        </span>
                      )}
                      {plan && (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {readCounts.get(lesson.slug) ?? 0} из {plan.steps.length} шагов
                        </span>
                      )}
                    </span>
                  </Link>
                  <ImportButton
                    key="import"
                    slug={lesson.slug}
                    imported
                    hasPlan={plan !== null}
                    firstRun={firstRun}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
