import { loadConfig } from "@/lib/config";
import { runImport } from "@/lib/source/import-request";

interface Body {
  slug?: unknown;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) return Response.json({ error: "Не передан слаг урока" }, { status: 400 });

  try {
    const result = runImport(loadConfig(), slug);
    if ("status" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result);
  } catch (error) {
    // Сюда попадает, например, неоднозначный каталог упражнения из
    // findExerciseDir: это поломка данных курса, а не запроса.
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
