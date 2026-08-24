import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { repoRelative, SAFE_SEGMENT } from "../content/paths";
import { describeFunctions, extractFunction, replaceFunction } from "./file";

const projectSlug = /^19-capstone-projects__(\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const manifestSchema = z.object({
  version: z.literal(1),
  targets: z.array(z.object({
    file: z.literal("main.py"),
    symbol: z.string().min(1),
    tests: z.array(z.string().min(1)).min(1),
    bench: z.boolean().optional(),
  })).min(1),
});

export interface ProjectContract {
  dir: string;
  template: string;
  solution: string;
  work: string;
  test: string;
  targets: z.infer<typeof manifestSchema>["targets"];
}

export function readProjectContract(sourceDir: string, slug: string, milestoneId: string): ProjectContract | null {
  const match = projectSlug.exec(slug);
  if (!match || !SAFE_SEGMENT.test(milestoneId)) return null;
  const root = path.resolve(sourceDir, "learning-projects");
  const dir = path.resolve(root, `p19-c${match[1]}`, milestoneId);
  if (!dir.startsWith(`${root}${path.sep}`)) return null;
  const manifestFile = path.join(dir, "contract.json");
  if (!fs.existsSync(manifestFile)) return null;
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(manifestFile, "utf8")));
  return {
    dir,
    template: path.join(dir, "contract.template", "main.py"),
    solution: path.join(dir, "solution", "main.py"),
    work: path.join(dir, "contract", "main.py"),
    test: path.join(dir, "test_contract.py"),
    targets: manifest.targets,
  };
}

function ensureWork(contract: ProjectContract): void {
  if (fs.existsSync(contract.work)) return;
  fs.mkdirSync(path.dirname(contract.work), { recursive: true });
  fs.copyFileSync(contract.template, contract.work, fs.constants.COPYFILE_EXCL);
}

export function readProjectContractFile(contract: ProjectContract) {
  ensureWork(contract);
  const code = fs.readFileSync(contract.work, "utf8");
  return {
    multi: true,
    verification: "pytest" as const,
    files: [{
      name: "main.py",
      file: contract.work,
      relPath: repoRelative(contract.work),
      code,
      mtimeMs: fs.statSync(contract.work).mtimeMs,
      functions: describeFunctions(code, contract.targets.map((item) => item.symbol)),
      createdFromTemplate: false,
    }],
  };
}

export function writeProjectContractFile(contract: ProjectContract, code: string, expectedMtimeMs: number) {
  ensureWork(contract);
  const currentMtime = fs.statSync(contract.work).mtimeMs;
  if (currentMtime !== expectedMtimeMs) {
    const current = fs.readFileSync(contract.work, "utf8");
    return {
      conflict: {
        name: "main.py",
        code: current,
        mtimeMs: currentMtime,
        functions: describeFunctions(current, contract.targets.map((item) => item.symbol)),
      },
    };
  }
  const temporary = `${contract.work}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, code, "utf8");
  fs.renameSync(temporary, contract.work);
  return {
    name: "main.py",
    mtimeMs: fs.statSync(contract.work).mtimeMs,
    functions: describeFunctions(code, contract.targets.map((item) => item.symbol)),
  };
}

export function resetProjectContractTarget(contract: ProjectContract, fn: string) {
  ensureWork(contract);
  const template = fs.readFileSync(contract.template, "utf8");
  const block = extractFunction(template, fn);
  if (!block) throw new Error(`В контракте нет цели ${fn}`);
  const current = fs.readFileSync(contract.work, "utf8");
  const code = replaceFunction(current, fn, block);
  const temporary = `${contract.work}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, code, "utf8");
  fs.renameSync(temporary, contract.work);
  return {
    name: "main.py",
    code,
    mtimeMs: fs.statSync(contract.work).mtimeMs,
    functions: describeFunctions(code, contract.targets.map((item) => item.symbol)),
  };
}
