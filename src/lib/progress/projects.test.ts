import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeProgressDb, openProgressDb } from "./db";
import {
  openMilestone,
  readProjectProgress,
  saveMilestoneEvidence,
  saveRubricScore,
} from "./projects";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    closeProgressDb(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function db() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "project-progress-"));
  dirs.push(dir);
  return { dir, value: openProgressDb(dir) };
}

describe("project progress", () => {
  it("держит контракт и реальное доказательство независимыми", () => {
    const { value } = db();
    openMilestone(value, "project", "m01-loop");
    saveMilestoneEvidence(value, "project", "m01-loop", "PR #42", true);
    const state = readProjectProgress(value, "project").milestones[0];
    expect(state.contractState).toBe("unopened");
    expect(state.verifiedAt).not.toBeNull();
    expect(state.evidence).toBe("PR #42");
  });

  it("сохраняет ручную рубрику отдельно по критериям", () => {
    const { value } = db();
    saveRubricScore(value, "project", "safety", 17, "Два red-team сценария ещё красные");
    expect(readProjectProgress(value, "project").rubric).toEqual([
      { criterion: "safety", score: 17, note: "Два red-team сценария ещё красные" },
    ]);
  });
});
