import { loadConfig } from "@/lib/config";
import {
  exerciseFileMtimeMs,
  readExerciseFiles,
  writeExerciseFileIfUnchanged,
} from "@/lib/exercise/file";
import { findLesson } from "@/lib/source/catalog";

interface PutBody {
  code?: unknown;
  /** Имя файла упражнения — обязательно и для одно-файловой формы. */
  file?: unknown;
  /** mtime файла, каким его видел клиент, — защита от затирания чужой правки. */
  mtimeMs?: unknown;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) return Response.json({ error: "Урок не найден" }, { status: 404 });

  const url = new URL(request.url);
  // ?meta=1 — то, чем редактор опрашивает файл на внешние правки: только время
  // изменения, без пересылки всего файла каждые две секунды.
  if (url.searchParams.get("meta") === "1") {
    // Имя файла обязательно: у многофайлового упражнения «время изменения
    // упражнения» — это не одно число, и молча взять первый файл значило бы
    // не замечать правку остальных. ?meta=1 без file подразумевает
    // exercise.py — так его посылает старый клиент.
    const name = url.searchParams.get("file") ?? "exercise.py";
    const mtimeMs = exerciseFileMtimeMs(config.sourceDir, ref, name);
    if (mtimeMs === null) {
      return Response.json({ error: `У этого урока нет файла ${name}` }, { status: 404 });
    }
    return Response.json({ mtimeMs });
  }

  const set = readExerciseFiles(config.sourceDir, ref);
  if (!set) return Response.json({ error: "У этого урока нет упражнения" }, { status: 404 });
  return Response.json(set);
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as PutBody;
  const code = typeof body.code === "string" ? body.code : null;
  const file = typeof body.file === "string" ? body.file.trim() : "";
  const expectedMtimeMs =
    typeof body.mtimeMs === "number" && Number.isFinite(body.mtimeMs) ? body.mtimeMs : null;

  if (code === null) return Response.json({ error: "Не передано поле code" }, { status: 400 });
  if (code.trim().length === 0) {
    return Response.json({ error: "Пустой код — запись отклонена" }, { status: 400 });
  }
  if (!file) return Response.json({ error: "Не передано поле file" }, { status: 400 });
  if (expectedMtimeMs === null) {
    return Response.json({ error: "Не передано поле mtimeMs" }, { status: 400 });
  }

  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) return Response.json({ error: "Урок не найден" }, { status: 404 });

  try {
    const result = writeExerciseFileIfUnchanged(
      config.sourceDir, ref, file, code, expectedMtimeMs,
    );
    // 409 с актуальным содержимым: файл на диске успел измениться (вставка
    // прошлого кода, правка из IDE), и клиент должен перечитать его, а не
    // затереть своим черновиком, получив в ответ «сохранено».
    if ("conflict" in result) {
      return Response.json(
        {
          error: "Файл упражнения изменился на диске — редактор перечитает его",
          current: result.conflict,
        },
        { status: 409 },
      );
    }
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
