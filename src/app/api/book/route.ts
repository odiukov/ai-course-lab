import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  availableBookPhases,
  bookFilename,
  buildPhaseBook,
  resolveChromeExecutable,
} from "@/lib/book/build";
import { mergeBookPdfs } from "@/lib/book/merge";
import { loadConfig } from "@/lib/config";

const run = promisify(execFile);

function completePdf(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  const size = fs.statSync(file).size;
  if (size < 6) return false;
  const length = Math.min(size, 1024);
  const handle = fs.openSync(file, "r");
  try {
    const tail = Buffer.alloc(length);
    fs.readSync(handle, tail, 0, length, size - length);
    return tail.includes(Buffer.from("%%EOF"));
  } finally {
    fs.closeSync(handle);
  }
}

/** Chrome on macOS can keep its updater alive after --print-to-pdf is done. */
function printWithChrome(chrome: string, args: string[], pdfPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const detached = process.platform !== "win32";
    const child = spawn(chrome, args, { detached, stdio: "ignore" });
    let settled = false;

    const stop = () => {
      if (!child.pid || child.killed) return;
      try {
        if (detached) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        // It exited between the completeness check and termination.
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      stop();
      if (error) reject(error);
      else resolve();
    };
    const poll = setInterval(() => {
      if (completePdf(pdfPath)) finish();
    }, 250);
    const timeout = setTimeout(
      () => finish(new Error("Chrome не закончил печать за 3 минуты")),
      180_000,
    );

    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (completePdf(pdfPath)) finish();
      else finish(new Error(`Chrome завершился с кодом ${code ?? "неизвестно"}`));
    });
  });
}

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

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-course-book-"));
  const phasePdfs: string[] = [];

  try {
    for (const phase of phases) {
      const htmlPath = path.join(tempDir, `phase-${phase}.html`);
      const pdfPath = path.join(tempDir, bookFilename(phase));
      const profileDir = path.join(tempDir, `chrome-profile-${phase}`);
      await run(
        process.execPath,
        [
          path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
          path.join(process.cwd(), "scripts/render-book.mts"),
          String(phase),
          htmlPath,
        ],
        { timeout: 120_000, maxBuffer: 1024 * 1024 },
      );
      await printWithChrome(
        chrome,
        [
          "--headless=new",
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-sync",
          "--disable-extensions",
          "--disable-gpu",
          "--no-first-run",
          "--no-pdf-header-footer",
          "--allow-file-access-from-files",
          "--run-all-compositor-stages-before-draw",
          `--user-data-dir=${profileDir}`,
          `--print-to-pdf=${pdfPath}`,
          pathToFileURL(htmlPath).href,
        ],
        pdfPath,
      );
      if (!fs.existsSync(pdfPath)) throw new Error(`Chrome не создал PDF фазы ${phase}`);
      phasePdfs.push(pdfPath);
    }

    const pdf = requestedPhase === null
      ? await mergeBookPdfs(phasePdfs)
      : new Uint8Array(fs.readFileSync(phasePdfs[0]));
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
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
