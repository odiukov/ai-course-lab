import fs from "node:fs";
import { loadConfig } from "@/lib/config";
import { resolveVisualPath } from "@/lib/api/visual-path";

export async function GET(request: Request) {
  const config = loadConfig();
  const rel = new URL(request.url).searchParams.get("path") ?? "";
  const resolved = resolveVisualPath(config.sourceDir, rel);

  if (!resolved.ok) {
    return resolved.reason === "not-found"
      ? new Response("Не найдено", { status: 404 })
      : new Response("Запрещённый путь", { status: 400 });
  }

  return new Response(fs.readFileSync(resolved.path, "utf8"), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
