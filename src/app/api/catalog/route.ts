import { loadConfig } from "@/lib/config";
import { readMergedCatalog } from "@/lib/source/merged-catalog";

export async function GET() {
  const config = loadConfig();
  return Response.json(readMergedCatalog(config.sourceDir, config.courseRepo));
}
