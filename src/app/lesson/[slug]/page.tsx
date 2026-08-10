import { Suspense } from "react";
import { loadConfig } from "@/lib/config";
import { readLessonPlan } from "@/lib/content/lesson-plan";
import { openProgressDb } from "@/lib/progress/db";
import { readLessonProgress, resumeIndex } from "@/lib/progress/steps";
import { Reader } from "./reader";

// Читает базу на каждый заход, поэтому кэшировать страницу нельзя: иначе
// «продолжить с того места» показывало бы позицию, актуальную на момент сборки.
export const dynamic = "force-dynamic";

export default async function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = loadConfig();
  const plan = readLessonPlan(config.contentDir, slug);
  // База отвечает на вопрос «куда открыть» ровно один раз и только здесь;
  // дальше единственная правда о текущем шаге — параметр step в адресе.
  const initialIndex = plan
    ? resumeIndex(readLessonProgress(openProgressDb(config.dataDir), slug), plan.steps)
    : 0;
  const lspUrl = `ws://127.0.0.1:${config.lspPort}`;

  return (
    <Suspense fallback={<p className="text-slate-400">Загружаю…</p>}>
      <Reader slug={slug} initialIndex={initialIndex} lspUrl={lspUrl} />
    </Suspense>
  );
}
