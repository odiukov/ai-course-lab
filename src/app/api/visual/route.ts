import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";

export async function GET(request: Request) {
  const config = loadConfig();
  const rel = new URL(request.url).searchParams.get("path") ?? "";
  const root = path.join(config.sourceDir, "learning-visuals");
  const target = path.resolve(config.sourceDir, rel);

  if (!target.startsWith(`${root}${path.sep}`) || !target.endsWith(".html")) {
    return new Response("Запрещённый путь", { status: 400 });
  }
  if (!fs.existsSync(target)) return new Response("Не найдено", { status: 404 });

  return new Response(fs.readFileSync(target, "utf8"), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
