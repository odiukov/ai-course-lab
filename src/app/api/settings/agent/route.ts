import { loadConfig } from "@/lib/config";
import { openProgressDb } from "@/lib/progress/db";
import { isAgentName, readAgent, writeAgent } from "@/lib/progress/settings";

interface Body {
  agent?: unknown;
}

export async function GET() {
  const config = loadConfig();
  const db = openProgressDb(config.dataDir);
  return Response.json({ agent: readAgent(db, config.agent) });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  if (!isAgentName(body.agent)) {
    return Response.json({ error: "Агент должен быть claude или codex" }, { status: 400 });
  }

  const config = loadConfig();
  const db = openProgressDb(config.dataDir);
  writeAgent(db, body.agent);
  return Response.json({ agent: body.agent });
}
