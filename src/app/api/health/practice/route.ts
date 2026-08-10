import { loadConfig } from "@/lib/config";
import { checkPractice } from "@/lib/practice/health";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await checkPractice(loadConfig()));
}
