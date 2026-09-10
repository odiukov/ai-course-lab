import {
  availableBookPhases,
  bookFilename,
  buildPhaseBook,
  resolveChromeExecutable,
} from "@/lib/book/build";
import { generateBookPdf } from "@/lib/book/pdf";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let requestedPhase: number | null;
  try {
    const payload = (await request.json()) as { phase?: unknown };
    requestedPhase = payload.phase === undefined ? null : Number(payload.phase);
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  if (
    requestedPhase !== null &&
    (!Number.isInteger(requestedPhase) || requestedPhase < 1 || requestedPhase > 99)
  ) {
    return Response.json({ error: "Некорректный номер фазы" }, { status: 400 });
  }

  const config = loadConfig();
  const phases = requestedPhase === null ? availableBookPhases(config) : [requestedPhase];
  if (phases.length === 0) {
    return Response.json({ error: "Пока нет подготовленных уроков" }, { status: 404 });
  }
  if (requestedPhase !== null) {
    const book = buildPhaseBook(config, requestedPhase);
    if (!book || book.lessons.length === 0) {
      return Response.json({ error: "В этой фазе пока нет подготовленных уроков" }, { status: 404 });
    }
  }

  const chrome = resolveChromeExecutable();
  if (!chrome) {
    return Response.json(
      { error: "Chrome не найден. Укажи путь к нему в CHROME_PATH." },
      { status: 503 },
    );
  }

  try {
    const pdf = await generateBookPdf({ config, phases, chrome });
    const responseBody = new Uint8Array(pdf.byteLength);
    responseBody.set(pdf);
    return new Response(responseBody, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${bookFilename(requestedPhase)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "неизвестная ошибка";
    return Response.json({ error: `Сборка PDF не удалась: ${message}` }, { status: 500 });
  }
}
