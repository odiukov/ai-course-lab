import Link from "next/link";
import { loadConfig } from "@/lib/config";
import { readMergedCatalog } from "@/lib/source/merged-catalog";
import { readLessonPlan } from "@/lib/content/lesson-plan";

export const dynamic = "force-dynamic";

export default function CatalogPage() {
  const config = loadConfig();
  const phases = readMergedCatalog(config.sourceDir, config.courseRepo);

  return (
    <main>
      <h1 className="mb-8 text-3xl font-semibold">Курс</h1>
      {phases.map((phase) => (
        <section key={phase.dir} className="mb-8">
          <h2 className="mb-3 text-lg font-medium text-slate-500">
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
                    className="flex items-baseline gap-2 px-2 py-1 text-slate-400"
                    title={`npm run import -- ${lesson.slug}`}
                  >
                    <span className="tabular-nums">{lesson.lessonNumber}</span>
                    <span>{lesson.title}</span>
                    <span className="ml-auto text-xs">не импортирован</span>
                  </li>
                );
              }

              return (
                <li key={lesson.slug}>
                  <Link
                    href={`/lesson/${lesson.slug}`}
                    className="flex items-baseline gap-2 rounded px-2 py-1 hover:bg-slate-100"
                  >
                    <span className="tabular-nums text-slate-400">{lesson.lessonNumber}</span>
                    <span>{lesson.title}</span>
                    {plan && (
                      <span className="ml-auto text-xs text-emerald-600">
                        {plan.steps.length} шагов
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
