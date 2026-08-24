import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendProjectClarification,
  readProjectClarifications,
} from "./project";

describe("project clarifications", () => {
  it("хранит уточнения отдельно по milestone и сохраняет markdown в каталоге проекта", () => {
    const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-content-"));
    const slug = "19-capstone-projects__01-terminal-agent";
    appendProjectClarification(contentDir, slug, "m01-loop", {
      askedAt: "2026-08-23T10:00:00.000Z",
      question: "Где проходит граница?",
      answer: "На входе диспетчера.",
    });

    expect(readProjectClarifications(contentDir, slug, "m01-loop")).toEqual([{
      askedAt: "2026-08-23T10:00:00.000Z",
      question: "Где проходит граница?",
      answer: "На входе диспетчера.",
    }]);
    expect(readProjectClarifications(contentDir, slug, "m02-state")).toEqual([]);
    expect(fs.existsSync(path.join(contentDir, "projects", slug, "clarifications", "m01-loop.md"))).toBe(true);
  });

  it("не позволяет milestone выйти из каталога проекта", () => {
    const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-content-safe-"));
    expect(() => readProjectClarifications(
      contentDir,
      "19-capstone-projects__01-terminal-agent",
      "../escape",
    )).toThrow("Небезопасный milestone id");
  });
});
