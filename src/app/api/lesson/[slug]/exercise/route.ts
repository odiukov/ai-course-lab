import { loadConfig } from "@/lib/config";
import { exerciseMtimeMs, readExerciseFile, writeExerciseCode } from "@/lib/exercise/file";
import { findLesson } from "@/lib/source/catalog";

interface PutBody {
  code?: unknown;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) return Response.json({ error: "Урок не найден" }, { status: 404 });

  // ?meta=1 — то, чем редактор опрашивает файл на внешние правки: только время
  // изменения, без пересылки всего файла каждые две секунды.
  if (new URL(request.url).searchParams.get("meta") === "1") {
    return Response.json({ mtimeMs: exerciseMtimeMs(config.sourceDir, ref) });
  }

  const file = readExerciseFile(config.sourceDir, ref);
  if (!file) {
    return Response.json({ error: "У этого урока нет упражнения" }, { status: 404 });
  }
  return Response.json(file);
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as PutBody;
  const code = typeof body.code === "string" ? body.code : null;

  if (code === null) {
    return Response.json({ error: "Не передано поле code" }, { status: 400 });
  }
  if (code.trim().length === 0) {
    return Response.json({ error: "Пустой код — запись отклонена" }, { status: 400 });
  }

  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) return Response.json({ error: "Урок не найден" }, { status: 404 });

  try {
    return Response.json(writeExerciseCode(config.sourceDir, ref, code));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
