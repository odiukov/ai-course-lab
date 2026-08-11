import { loadConfig } from "@/lib/config";
import { openProgressDb } from "@/lib/progress/db";
import { recordImport } from "@/lib/progress/imports";
import { runImport } from "@/lib/source/import-request";

interface Body {
  slug?: unknown;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) return Response.json({ error: "Не передан слаг урока" }, { status: 400 });

  try {
    const config = loadConfig();
    const result = runImport(config, slug);
    if ("status" in result) return Response.json({ error: result.error }, { status: result.status });
    // Дата пишется и когда импорт не принёс ни одного файла: вопрос, на
    // который она отвечает, — «когда я в последний раз сверялся с курсом»,
    // а не «когда что-то изменилось».
    recordImport(openProgressDb(config.dataDir), slug);
    return Response.json(result);
  } catch (error) {
    // Сюда попадает, например, неоднозначный каталог упражнения из
    // findExerciseDir: это поломка данных курса, а не запроса.
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
