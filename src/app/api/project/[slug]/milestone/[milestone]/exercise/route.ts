import fs from "node:fs";
import { loadConfig } from "@/lib/config";
import {
  readProjectContract,
  readProjectContractFile,
  writeProjectContractFile,
} from "@/lib/exercise/project-contract";

type Params = { params: Promise<{ slug: string; milestone: string }> };

export async function GET(request: Request, { params }: Params) {
  const { slug, milestone } = await params;
  const config = loadConfig();
  const contract = readProjectContract(config.sourceDir, slug, milestone);
  if (!contract) return Response.json({ error: "Контракт этапа не найден" }, { status: 404 });
  const url = new URL(request.url);
  if (url.searchParams.get("meta") === "1") {
    return Response.json({ mtimeMs: fs.existsSync(contract.work) ? fs.statSync(contract.work).mtimeMs : null });
  }
  return Response.json(readProjectContractFile(contract));
}

export async function PUT(request: Request, { params }: Params) {
  const { slug, milestone } = await params;
  const body = (await request.json().catch(() => ({}))) as { file?: unknown; code?: unknown; mtimeMs?: unknown };
  if (body.file !== "main.py" || typeof body.code !== "string" || !body.code.trim() || typeof body.mtimeMs !== "number") {
    return Response.json({ error: "Нужны main.py, непустой code и mtimeMs" }, { status: 400 });
  }
  const config = loadConfig();
  const contract = readProjectContract(config.sourceDir, slug, milestone);
  if (!contract) return Response.json({ error: "Контракт этапа не найден" }, { status: 404 });
  const result = writeProjectContractFile(contract, body.code, body.mtimeMs);
  if ("conflict" in result) {
    return Response.json({ error: "Файл контракта изменился на диске", current: result.conflict }, { status: 409 });
  }
  return Response.json(result);
}
