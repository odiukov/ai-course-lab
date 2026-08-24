import Link from "next/link";
import { loadConfig } from "@/lib/config";
import { hasClone } from "@/lib/source/upstream";
import { readMergedCatalog } from "@/lib/source/merged-catalog";
import { readLessonPlan } from "@/lib/content/lesson-plan";
import { readPhase19Tracks } from "@/lib/content/phase-19-tracks";
import { readProject } from "@/lib/content/project";
import { plural, since } from "@/lib/content/since";
import { diffLesson } from "@/lib/source/import-lesson";
import { openProgressDb } from "@/lib/progress/db";
import { readImportDates } from "@/lib/progress/imports";
import { readLessonReadCounts } from "@/lib/progress/steps";
import { readProjectProgress } from "@/lib/progress/projects";
import { AgentPicker } from "@/components/AgentPicker";
import ImportButton from "@/components/ImportButton";

export const dynamic = "force-dynamic";

export default function CatalogPage() {
  const config = loadConfig();
  const phases = readMergedCatalog(config.sourceDir, config.courseRepo);
  const plans = new Map<string, ReturnType<typeof readLessonPlan>>();
  const stepsByLesson = new Map<
    string,
    NonNullable<ReturnType<typeof readLessonPlan>>["steps"]
  >();
  for (const phase of phases) {
    for (const lesson of phase.lessons) {
      if (!lesson.imported) continue;
      const plan = readLessonPlan(config.contentDir, lesson.slug);
      plans.set(lesson.slug, plan);
      if (plan) stepsByLesson.set(lesson.slug, plan.steps);
    }
  }
  // Каталог — серверный компонент, поэтому читает базу напрямую: один запрос на
  // всю страницу вместо эндпоинта и похода за каждой строкой.
  const db = openProgressDb(config.dataDir);
  const readCounts = readLessonReadCounts(db, stepsByLesson);
  const importDates = readImportDates(db);
  // Первый клик без кэша клонирует курс целиком — кнопке нужно сказать об
  // этом словами, иначе долгое молчание читается как зависание.
  const firstRun = !hasClone(config.upstreamDir);
  // Те же два источника, что у импорта: упражнения и визуализации живут только
  // в форке, и без него строка обещала бы «обновлять нечего» там, где кнопка
  // на самом деле принесёт файлы.
  const repos = [config.courseRepo, config.localCourseRepo].filter(
    (repo): repo is string => repo !== null,
  );
  const phase19 = phases.find((phase) => phase.number === 19);
  const phase19Tracks = phase19 ? readPhase19Tracks(config.contentDir) : [];
  const phase19Lessons = new Map(
    (phase19?.lessons ?? []).map((lesson) => [lesson.lessonDir, lesson]),
  );
  const projectRows = (phase19?.lessons ?? [])
    .filter((lesson) => lesson.lessonNumber <= 17)
    .map((lesson) => {
      const project = readProject(config.contentDir, lesson.slug);
      const progress = project ? readProjectProgress(db, lesson.slug) : null;
      const complete = Boolean(project && progress) &&
        project!.milestones.every((milestone) => {
          const state = progress!.milestones.find((item) => item.milestoneId === milestone.id);
          const contractDone = milestone.contractTargets.length === 0 || state?.contractState === "passed";
          return contractDone && Boolean(state?.verifiedAt);
        }) &&
        project!.rubric.every((criterion) =>
          progress!.rubric.some((item) => item.criterion === criterion.id && item.score !== null),
        );
      return { lesson, project, complete };
    });
  const completeTracks = phase19Tracks.filter((track) =>
    track.labs.every((lab) => {
      const lesson = phase19Lessons.get(lab);
      if (!lesson) return false;
      const plan = plans.get(lesson.slug);
      return Boolean(plan) && (readCounts.get(lesson.slug) ?? 0) === plan!.steps.length;
    }),
  ).length;

  return (
    <main className="mx-auto max-w-3xl">
      <div className="mb-8 flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold">AI Lab</h1>
        <AgentPicker />
      </div>
      {phases.filter((phase) => phase.number !== 19).map((phase) => (
        <section key={phase.dir} className="mb-8">
          <h2 className="mb-3 text-lg font-medium text-slate-500 dark:text-slate-400">
            Фаза {phase.number}. {phase.title}
          </h2>
          <ul className="space-y-1">
            {phase.lessons.map((lesson) => {
              const plan = plans.get(lesson.slug) ?? null;

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
              const diff =
                repos.length > 0
                  ? diffLesson(repos, config.sourceDir, lesson)
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
      {phase19 && (
        <section className="mb-8 space-y-6">
          <div>
            <h2 className="text-lg font-medium text-slate-500 dark:text-slate-400">
              Фаза 19. Проектный каталог
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Треков пройдено {completeTracks} из {phase19Tracks.length} · капстоунов сдано {projectRows.filter((item) => item.complete).length} из {projectRows.length}
            </p>
          </div>

          <div>
            <h3 className="mb-2 font-medium">Капстоуны портфолио</h3>
            <ul className="space-y-1">
              {projectRows.map(({ lesson, project, complete }) => (
                <li key={lesson.slug}>
                  {project ? (
                    <Link href={`/project/${lesson.slug}`} className="flex items-baseline gap-2 rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                      <span className="tabular-nums text-slate-500">{lesson.lessonNumber}</span>
                      <span>{project.title}</span>
                      <span className="ml-auto text-xs text-violet-600 dark:text-violet-400">{complete ? "сдан" : project.time}</span>
                    </Link>
                  ) : (
                    <div className="flex items-baseline gap-2 px-2 py-1 text-slate-400">
                      <span className="tabular-nums">{lesson.lessonNumber}</span><span>{lesson.title}</span><span className="ml-auto text-xs">готовится</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="font-medium">Лабораторные треки</h3>
            {phase19Tracks.map((track) => {
              const completed = track.labs.filter((lab) => {
                const lesson = phase19Lessons.get(lab);
                if (!lesson) return false;
                const plan = plans.get(lesson.slug);
                return Boolean(plan) && (readCounts.get(lesson.slug) ?? 0) === plan!.steps.length;
              }).length;
              return (
                <details key={track.id} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                  <summary className="cursor-pointer">
                    <span className="font-medium">{track.title}</span>
                    <span className="ml-2 text-xs text-slate-500">{completed} из {track.labs.length}</span>
                  </summary>
                  <p className="my-2 text-sm text-slate-500">{track.purpose}</p>
                  <ul className="space-y-1">
                    {track.labs.map((lab) => {
                      const lesson = phase19Lessons.get(lab);
                      if (!lesson) return null;
                      const plan = plans.get(lesson.slug) ?? null;
                      return (
                        <li key={lab}>
                          <Link href={`/lesson/${lesson.slug}`} className="flex items-baseline gap-2 rounded px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                            <span className="tabular-nums text-slate-400">{lesson.lessonNumber}</span>
                            <span>{lesson.title}</span>
                            {plan && <span className="ml-auto text-xs text-emerald-600">{readCounts.get(lesson.slug) ?? 0} из {plan.steps.length}</span>}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
