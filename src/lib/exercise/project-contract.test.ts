import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  readProjectContract,
  readProjectContractFile,
  resetProjectContractTarget,
  writeProjectContractFile,
} from "./project-contract";

const TEMPLATE = [
  "def alpha(value):",
  "    raise NotImplementedError",
  "",
  "",
  "def beta(value):",
  "    return value + 1",
  "",
].join("\n");

function makeContract(): { sourceDir: string; dir: string } {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-contract-"));
  const dir = path.join(
    sourceDir,
    "learning-projects",
    "p19-c01-terminal-agent",
    "m01-command-loop",
  );
  fs.mkdirSync(path.join(dir, "contract.template"), { recursive: true });
  fs.mkdirSync(path.join(dir, "solution"), { recursive: true });
  fs.writeFileSync(path.join(dir, "contract.template", "main.py"), TEMPLATE, "utf8");
  fs.writeFileSync(path.join(dir, "solution", "main.py"), TEMPLATE.replace("raise NotImplementedError", "return value"), "utf8");
  fs.writeFileSync(path.join(dir, "test_contract.py"), "", "utf8");
  fs.writeFileSync(path.join(dir, "contract.json"), JSON.stringify({
    version: 1,
    targets: [{ file: "main.py", symbol: "alpha", tests: ["test_contract.py::test_alpha"] }],
  }), "utf8");
  return { sourceDir, dir };
}

describe("project contract workspace", () => {
  it("находит только безопасный проект и разворачивает рабочую копию", () => {
    const { sourceDir, dir } = makeContract();
    const contract = readProjectContract(
      sourceDir,
      "19-capstone-projects__01-terminal-agent",
      "m01-command-loop",
    );

    expect(contract?.dir).toBe(dir);
    const file = readProjectContractFile(contract!);
    expect(file.files[0].code).toBe(TEMPLATE);
    expect(file.files[0].functions[0]).toMatchObject({ fn: "alpha", implemented: false });
    expect(fs.existsSync(path.join(dir, "contract", "main.py"))).toBe(true);
    expect(readProjectContract(sourceDir, "../01-terminal-agent", "m01-command-loop")).toBeNull();
    expect(readProjectContract(sourceDir, "19-capstone-projects__01-terminal-agent", "../escape")).toBeNull();
  });

  it("защищает запись mtime-конфликтом и сбрасывает только выбранный шов", () => {
    const { sourceDir } = makeContract();
    const contract = readProjectContract(
      sourceDir,
      "19-capstone-projects__01-terminal-agent",
      "m01-command-loop",
    )!;
    const opened = readProjectContractFile(contract).files[0];
    const implemented = TEMPLATE.replace("raise NotImplementedError", "return value * 2");

    expect(writeProjectContractFile(contract, implemented, -1)).toHaveProperty("conflict");
    expect(writeProjectContractFile(contract, implemented, opened.mtimeMs)).not.toHaveProperty("conflict");
    const reset = resetProjectContractTarget(contract, "alpha");
    expect(reset.code).toBe(TEMPLATE);
    expect(reset.code).toContain("def beta(value):\n    return value + 1");
  });
});
