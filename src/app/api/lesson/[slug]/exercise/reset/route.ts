import { loadConfig } from "@/lib/config";
import { resetFunctionToTemplate } from "@/lib/exercise/reset";
import { findLesson } from "@/lib/source/catalog";

interface Body {
  fn?: unknown;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as Body;
  const fn = typeof body.fn === "string" ? body.fn.trim() : "";
  if (!fn) return Response.json({ error: "Не передана функция" }, { status: 400 });

  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) return Response.json({ error: "Урок не найден" }, { status: 404 });

  try {
    const result = resetFunctionToTemplate(config.sourceDir, ref, fn);
    if ("error" in result) return Response.json({ error: result.error }, { status: 404 });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
