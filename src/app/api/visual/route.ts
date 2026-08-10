import fs from "node:fs";
import { loadConfig } from "@/lib/config";
import {
  resolveGeneratedVisualPath,
  resolveVisualPath,
  type VisualPathResolution,
} from "@/lib/api/visual-path";

// Схема — это HTML со своим скриптом, и браузер исполняет его с правами
// нашего origin: `sandbox="allow-scripts"` на iframe сеть не режет, а открытая
// прямой ссылкой схема вообще не в iframe. Поэтому запрет ходить наружу едет
// заголовком: `default-src 'none'` закрывает fetch, import(), @import, url()
// и картинки, а разрешено ровно то, без чего схема не нарисуется, — свои
// инлайновые стили и скрипт. Заголовок один на оба пространства имён: и
// пришедшие с курсом схемы, и наши исполняются в браузере одинаково.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

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
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": CSP,
    },
  });
}
