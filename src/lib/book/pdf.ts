import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Config } from "../config";
import { bookFilename } from "./build";
import { mergeBookPdfs } from "./merge";

const run = promisify(execFile);

export function completePdf(file: string): boolean {
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

/** Печатает фазы по одной, затем объединяет их без гигантского DOM в браузере. */
export async function generateBookPdf(options: {
  config: Config;
  phases: number[];
  chrome: string;
  root?: string;
  onPhase?: (phase: number, index: number, total: number) => void;
}): Promise<Uint8Array> {
  const root = options.root ?? process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-course-book-"));
  const phasePdfs: string[] = [];

  try {
    for (const [index, phase] of options.phases.entries()) {
      options.onPhase?.(phase, index, options.phases.length);
      const htmlPath = path.join(tempDir, `phase-${phase}.html`);
      const pdfPath = path.join(tempDir, bookFilename(phase));
      const profileDir = path.join(tempDir, `chrome-profile-${phase}`);
      await run(
        process.execPath,
        [
          path.join(root, "node_modules/tsx/dist/cli.mjs"),
          path.join(root, "scripts/render-book.mts"),
          String(phase),
          htmlPath,
        ],
        { cwd: root, timeout: 120_000, maxBuffer: 1024 * 1024 },
      );
      await printWithChrome(
        options.chrome,
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
      if (!completePdf(pdfPath)) throw new Error(`Chrome не создал PDF фазы ${phase}`);
      phasePdfs.push(pdfPath);
    }

    if (options.phases.length === 1) {
      return new Uint8Array(fs.readFileSync(phasePdfs[0]));
    }

    // Wait for pdf-lib to finish reading every phase before removing tempDir.
    const merged = await mergeBookPdfs(phasePdfs);
    return merged;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
