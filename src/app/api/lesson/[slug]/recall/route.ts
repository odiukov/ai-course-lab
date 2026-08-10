import { loadConfig } from "@/lib/config";
import { findExercise } from "@/lib/exercise/file";
import { findPreviousImplementation, insertPreviousImplementation } from "@/lib/exercise/recall";
import { findLesson } from "@/lib/source/catalog";

interface Body {
  fn?: unknown;
}

function resolve(slug: string, fn: string) {
  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) return { error: "Урок не найден", status: 404 as const };
  const current = findExercise(config.sourceDir, ref);
  const previous = findPreviousImplementation(config.sourceDir, fn, current?.slug ?? "");
  if (!previous) return { error: `Функция ${fn} раньше не писалась`, status: 404 as const };
  return { config, ref, previous };
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const fn = new URL(request.url).searchParams.get("fn")?.trim() ?? "";
  if (!fn) return Response.json({ error: "Не передана функция" }, { status: 400 });

  const resolved = resolve(slug, fn);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }
  return Response.json(resolved.previous);
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as Body;
  const fn = typeof body.fn === "string" ? body.fn.trim() : "";
  if (!fn) return Response.json({ error: "Не передана функция" }, { status: 400 });

  const resolved = resolve(slug, fn);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }

  const { config, ref, previous } = resolved;
  // Прошлый код встаёт на место заготовки: спека прямо говорит, что дальше он
  // используется как есть, а не переписывается заново. Если в упражнении
  // этого урока функции нет вовсе, insertPreviousImplementation отдаёт
  // ошибку — файл не тронут, и отвечать 200 в этом случае нельзя.
  const result = insertPreviousImplementation(config.sourceDir, ref, fn, previous);
  if ("error" in result) return Response.json({ error: result.error }, { status: 404 });
  return Response.json(result);
}
