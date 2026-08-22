import { loadConfig } from "@/lib/config";
import { readExerciseTree } from "@/lib/exercise/tree";
import { checkPractice } from "@/lib/practice/health";
import { findLesson } from "@/lib/source/catalog";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = loadConfig();
  const slug = new URL(request.url).searchParams.get("slug");
  const ref = slug ? findLesson(config.sourceDir, slug) : null;
  const exercise = ref ? readExerciseTree(config.sourceDir, ref) : null;
  return Response.json(
    await checkPractice(config, exercise?.requirements ?? [], exercise?.network ?? false),
  );
}
