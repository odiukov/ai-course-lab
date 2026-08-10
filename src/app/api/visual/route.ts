import fs from "node:fs";
import { loadConfig } from "@/lib/config";
import {
  resolveGeneratedVisualPath,
  resolveVisualPath,
  type VisualPathResolution,
} from "@/lib/api/visual-path";

// Два пространства имён вместо одного смешанного: `?path=` адресует то, что
// пришло с курсом, `?lesson=&step=` — то, что нарисовали мы. Иначе резолвер
// не смог бы отличить одно от другого по одной строке.
export async function GET(request: Request) {
  const config = loadConfig();
  const params = new URL(request.url).searchParams;
  const lesson = params.get("lesson");
  const step = params.get("step");

  // Аннотация обязательна: без неё `let` выводится в any, и ветка с литералом
  // `{ ok: false }` перестаёт проверяться на совпадение с типом резолвера.
  let resolved: VisualPathResolution;
  if (lesson !== null || step !== null) {
    // Половина пары — ошибка запроса, а не повод искать в source-визуалах:
    // молчаливый откат на `?path=` вернул бы 400 с неверной причиной.
    resolved =
      lesson && step
        ? resolveGeneratedVisualPath(config.contentDir, lesson, step)
        : { ok: false, reason: "forbidden" };
  } else {
    resolved = resolveVisualPath(config.sourceDir, params.get("path") ?? "");
  }

  if (!resolved.ok) {
    return resolved.reason === "not-found"
      ? new Response("Не найдено", { status: 404 })
      : new Response("Запрещённый путь", { status: 400 });
  }

  return new Response(fs.readFileSync(resolved.path, "utf8"), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
