import { loadConfig } from "@/lib/config";
import { readProjectContract, resetProjectContractTarget } from "@/lib/exercise/project-contract";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; milestone: string }> }) {
  const { slug, milestone } = await params;
  const body = (await request.json().catch(() => ({}))) as { fn?: unknown };
  const fn = typeof body.fn === "string" ? body.fn : "";
  const config = loadConfig();
  const contract = readProjectContract(config.sourceDir, slug, milestone);
  if (!contract) return Response.json({ error: "Контракт этапа не найден" }, { status: 404 });
  try {
    return Response.json(resetProjectContractTarget(contract, fn));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
