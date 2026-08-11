import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LessonPlan } from "./lesson-plan";
import { formatPhaseOutlines, readPhaseOutlines } from "./phase-outlines";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "outlines-"));
}

function writePlan(contentDir: string, slug: string, title: string, titles: string[]): void {
  const plan: LessonPlan = {
    slug,
    title,
    lang: "ru",
    sourcePath: "source/x.md",
    sourceHash: "hash",
    generatedAt: "2026-08-11T00:00:00.000Z",
    steps: titles.map((stepTitle, index) => ({
      id: `${String(index + 1).padStart(3, "0")}-s`,
      type: "theory" as const,
      title: stepTitle,
    })),
  };
  const dir = path.join(contentDir, "lessons", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "lesson.json"), JSON.stringify(plan), "utf8");
}

describe("readPhaseOutlines", () => {
  it("без соседей отдаёт пустой список", () => {
    const contentDir = tmpDir();
    writePlan(contentDir, "01-math__01-alpha", "Alpha", ["Вектор"]);
    expect(readPhaseOutlines(contentDir, "01-math__01-alpha")).toEqual([]);
  });

  it("собирает соседей своей фазы и сортирует по номеру урока", () => {
    const contentDir = tmpDir();
    writePlan(contentDir, "01-math__03-gamma", "Gamma", ["Ранг"]);
    writePlan(contentDir, "01-math__01-alpha", "Alpha", ["Вектор", "Длина"]);
    writePlan(contentDir, "01-math__02-beta", "Beta", ["Матрица"]);

    const outlines = readPhaseOutlines(contentDir, "01-math__02-beta");

    expect(outlines.map((o) => o.number)).toEqual([1, 3]);
    expect(outlines[0].title).toBe("Alpha");
    expect(outlines[0].steps.map((s) => s.title)).toEqual(["Вектор", "Длина"]);
  });

  // Соседняя фаза — другой предмет; тащить её оглавление значит забивать
  // промпт тем, на что урок всё равно не должен ссылаться.
  it("не берёт уроки чужой фазы", () => {
    const contentDir = tmpDir();
    writePlan(contentDir, "01-math__01-alpha", "Alpha", ["Вектор"]);
    writePlan(contentDir, "02-ml__01-delta", "Delta", ["Регрессия"]);
    expect(readPhaseOutlines(contentDir, "01-math__01-alpha")).toEqual([]);
  });

  it("пропускает урок, у которого плана ещё нет", () => {
    const contentDir = tmpDir();
    writePlan(contentDir, "01-math__01-alpha", "Alpha", ["Вектор"]);
    fs.mkdirSync(path.join(contentDir, "lessons", "01-math__02-beta"), { recursive: true });
    expect(readPhaseOutlines(contentDir, "01-math__01-alpha")).toEqual([]);
  });

  it("не падает, когда каталога контента ещё нет", () => {
    expect(readPhaseOutlines(path.join(tmpDir(), "нет"), "01-math__01-alpha")).toEqual([]);
  });
});

describe("formatPhaseOutlines", () => {
  it("без соседей говорит об этом словами, а не пустотой", () => {
    expect(formatPhaseOutlines([])).toMatch(/нет/);
  });

  it("номер урока попадает в текст: по нему видно, что раньше, а что позже", () => {
    const text = formatPhaseOutlines([
      {
        slug: "01-math__01-alpha",
        number: 1,
        title: "Alpha",
        steps: [
          { title: "Вектор", type: "theory" },
          { title: "Длина", type: "theory" },
        ],
      },
    ]);
    expect(text).toContain("Урок 1. Alpha");
    expect(text).toContain("  - Вектор");
    expect(text).toContain("  - Длина");
  });

  // Урок, в котором тему ПИШУТ руками, владеет ею вернее того, где её
  // упомянули: планировщик должен видеть, чем тема закреплена.
  it("помечает шаг, который закрепляет тему упражнением", () => {
    const text = formatPhaseOutlines([
      {
        slug: "01-math__01-alpha",
        number: 1,
        title: "Alpha",
        steps: [{ title: "Пишем dot", type: "code", fn: "dot" }],
      },
    ]);
    expect(text).toContain("Пишем dot [пишут dot]");
  });
});
