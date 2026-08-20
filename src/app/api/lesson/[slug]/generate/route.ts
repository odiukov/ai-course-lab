import { defaultDeps } from "@/lib/agent/factory";
import { sseStream } from "@/lib/api/sse";
import { loadConfig } from "@/lib/config";
import { buildLesson } from "@/lib/generate/build-lesson";
import { openProgressDb } from "@/lib/progress/db";
import { readAgent } from "@/lib/progress/settings";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const search = new URL(request.url).searchParams;
  const rawFrom = search.get("from") ?? "0";
  const all = search.get("all") === "1";
  const from = Number(rawFrom);
  if (!Number.isInteger(from) || from < 0) {
    return Response.json(
      { error: `Параметр from должен быть целым числом ≥ 0, получено: ${rawFrom}` },
      { status: 400 },
    );
  }

  const config = loadConfig();
  // Сигнала запроса здесь намеренно нет, в отличие от чата и разбора кода.
  // Разбор урока — это десятки шагов, которые пишутся на диск по одному, и
  // привязка агента к открытой вкладке означала, что уход с каталога убивает
  // его на полуслове. От зависшего CLI страхует не сигнал, а таймаут в
  // runner.ts, а брошенный поток SSE безопасен: sseStream после разрыва
  // просто перестаёт писать.
  const deps = defaultDeps(config, {
    agent: readAgent(openProgressDb(config.dataDir), config.agent),
  });

  return sseStream(async (send) => {
    const ids = await buildLesson({
      config,
      slug,
      fromIndex: from,
      // `all=1` шлёт каталог: там разбор запускают один раз и уходят. Ридер
      // параметр не передаёт — ему хватает окна впереди читателя.
      all,
      deps,
      onProgress: (stage, text) => send("progress", { stage, text }),
      onPlan: (plan) => send("plan", plan),
      // Не throw: провал упражнения или схемы не должен рвать поток и отменять
      // уже написанные шаги. sseStream шлёт "error" только из catch, поэтому
      // кадр отправляется здесь руками — ридер уже умеет его показывать и
      // продолжать чтение.
      onSoftError: (message) => send("error", { message }),
    });

    send("done", { ids });
  });
}
