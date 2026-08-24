import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCoveredContext, NO_COVERED } from "./covered-context";
import { writeStep, type Step, type StepMeta } from "./step-file";

const SLUG = "01-math-foundations__01-alpha";

const PLAN: StepMeta[] = [
  { id: "001-t", type: "theory", title: "Точки и правила" },
  { id: "002-visual", type: "visual", title: "Вектор на плоскости" },
  { id: "003-dlina", type: "theory", title: "Длина вектора" },
  { id: "004-code", type: "code", title: "Пишем magnitude" },
  { id: "005-t", type: "theory", title: "Косинусная близость" },
];

function fixture(steps: Partial<Step>[]) {
  const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "covered-"));
  for (const step of steps) {
    const meta = PLAN.find((item) => item.id === step.id)!;
    writeStep(contentDir, SLUG, { ...meta, body: step.body ?? "Тело." });
  }
  return contentDir;
}

const covered = (contentDir: string, beforeStepId: string) =>
  buildCoveredContext({ contentDir, slug: SLUG, steps: PLAN, beforeStepId });

describe("buildCoveredContext", () => {
  it("до первого написанного шага говорит, что смотреть не на что", () => {
    expect(covered(fixture([]), "001-t")).toBe(NO_COVERED);
  });

  it("перечисляет заголовки предыдущих шагов с их номерами в плане", () => {
    const dir = fixture([{ id: "001-t" }, { id: "002-visual" }]);
    const out = covered(dir, "003-dlina");
    expect(out).toContain("[шаг 1](#step-1): Точки и правила");
    expect(out).toContain("[шаг 2](#step-2): Вектор на плоскости");
  });

  it("текущий шаг и те, что после него, в контекст не попадают", () => {
    const dir = fixture([{ id: "001-t" }, { id: "003-dlina" }, { id: "005-t" }]);
    const out = covered(dir, "003-dlina");
    expect(out).toContain("Точки и правила");
    expect(out).not.toContain("Длина вектора");
    expect(out).not.toContain("Косинусная близость");
  });

  it("ненаписанные шаги пропускаются, а не считаются пройденными", () => {
    const dir = fixture([{ id: "001-t" }]);
    expect(covered(dir, "003-dlina")).not.toContain("Вектор на плоскости");
  });

  // Ровно тот случай, из-за которого длина вектора выводилась заново на
  // четырёх шагах подряд: агент видел только ±2 заголовка и не знал, что
  // формула в уроке уже есть.
  it("формулы из уже написанных шагов перечислены с номером шага", () => {
    const dir = fixture([
      { id: "001-t", body: "Без формул." },
      { id: "002-visual", body: "Смотри:\n\n$$|v| = \\sqrt{x^2 + y^2}$$\n\nвот так." },
    ]);
    const out = covered(dir, "003-dlina");
    expect(out).toContain("|v| = \\sqrt{x^2 + y^2}");
    expect(out).toContain("[шаг 2](#step-2)");
  });

  it("одна и та же формула из двух шагов — один пункт, по первому шагу", () => {
    const dir = fixture([
      { id: "001-t", body: "$$a \\cdot b = 1$$" },
      { id: "002-visual", body: "$$a \\cdot b  =  1$$" },
    ]);
    const out = covered(dir, "003-dlina");
    expect(out.match(/a \\cdot b/g)).toHaveLength(1);
    const formulas = out.split("Формулы, которые в уроке уже выведены")[1];
    expect(formulas).toContain("[шаг 1](#step-1)");
    expect(formulas).not.toContain("[шаг 2](#step-2)");
  });

  it("сюжет аналогии попадает в контекст, чтобы его не переиспользовали", () => {
    const dir = fixture([
      {
        id: "001-t",
        body: "Текст.\n\n> 🎒 **На пальцах.** Ты вышел из входа в парк, прошёл три шага вправо по дорожке.",
      },
    ]);
    const out = covered(dir, "003-dlina");
    expect(out).toContain("парк");
  });

  it("шаг вне плана читается консервативно: пройденным не считается ничего", () => {
    const dir = fixture([{ id: "001-t" }, { id: "002-visual" }]);
    expect(covered(dir, "099-neizvestnyi")).toBe(NO_COVERED);
  });
});
