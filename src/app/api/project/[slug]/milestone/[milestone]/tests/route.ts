import path from "node:path";
import { loadConfig } from "@/lib/config";
import { readProject } from "@/lib/content/project";
import { readProjectContract, readProjectContractFile } from "@/lib/exercise/project-contract";
import { PracticeError } from "@/lib/practice/errors";
import { runTests } from "@/lib/practice/run-tests";
import { openProgressDb, execute } from "@/lib/progress/db";
import { recordTestRun } from "@/lib/progress/tests";

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string; milestone: string }> }) {
  const { slug, milestone } = await params;
  const config = loadConfig();
  const project = readProject(config.contentDir, slug);
  const contract = readProjectContract(config.sourceDir, slug, milestone);
  if (!project || !contract || !project.milestones.some((item) => item.id === milestone)) {
    return Response.json({ error: "Контракт этапа не найден" }, { status: 404 });
  }
  readProjectContractFile(contract);
  let result;
  try {
    result = await runTests({
      dir: contract.dir,
      python: config.python,
      pythonPath: path.dirname(contract.work),
      testNodes: contract.targets.flatMap((target) => target.tests),
    });
  } catch (error) {
    const kind = error instanceof PracticeError ? error.kind : "output";
    return Response.json({ error: (error as Error).message, kind }, { status: 503 });
  }
  const green = result.passed > 0 && result.failed === 0 && result.errors === 0;
  const db = openProgressDb(config.dataDir);
  recordTestRun(db, slug, milestone, contract.targets.map((target) => `main.py::${target.symbol}`).join(","), {
    passed: result.passed,
    failed: result.failed + result.errors,
    firstFailure: result.failures[0]?.decisive ?? null,
    filtered: true,
    warning: null,
  });
  execute(
    db,
    `INSERT INTO milestone_state (project_slug, milestone_id, contract_state, opened_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_slug, milestone_id) DO UPDATE SET contract_state = excluded.contract_state`,
    slug,
    milestone,
    green ? "passed" : "failed",
    new Date().toISOString(),
  );
  return Response.json({ result, state: green ? "passed" : "failed" });
}
