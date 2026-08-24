// Склейка файла упражнения проверяется на настоящем шаблоне курса, а не на
// придуманном: именно на нём она и подвела бы — отступы, докстроки, пустые
// строки между функциями.
import fs from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import type { Step, StepMeta } from "../content/step-file";
import { buildLessonModel } from "./lesson-page";
import { renderStepPage } from "./render";

const templatePath =
  "source/learning-exercises/p01-l01-linear-algebra-intuition/exercise.template.py";

describe("склейка файла упражнения", () => {
  it.skipIf(!fs.existsSync(templatePath))(
    "подставляет функцию в настоящий шаблон, не задев остальной файл",
    async () => {
      const template = fs.readFileSync(templatePath, "utf8");
      const plan: StepMeta[] = [
        { id: "007-code", type: "code", title: "Практика", exercise_fn: "magnitude" },
      ];
      const model = buildLessonModel({
        slug: "lesson-a",
        title: "Урок",
        steps: plan,
        written: { "007-code": { ...plan[0], body: "" } as Step },
        visualHrefByStepId: {},
      });

      const window = new Window({ url: "https://example.test/base/lesson/lesson-a/007-code/" });
      window.fetch = (async () =>
        ({ ok: true, text: async () => template })) as unknown as typeof window.fetch;

      const html = renderStepPage(model, 0, {
        basePath: "/base",
        exercise: {
          slug: "p01-l01",
          functions: ["magnitude", "dot"],
          urls: { template: "/t.py", test: "/x.py", solution: null },
        },
      });
      window.document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
      for (const script of [...window.document.body.querySelectorAll("script")]) {
        if (script.getAttribute("type") === "application/json") continue;
        window.eval(script.textContent ?? "");
      }
      await new Promise((resolve) => setTimeout(resolve, 0));

      const area = window.document.querySelector("[data-code]") as unknown as HTMLTextAreaElement;
      area.value = "def magnitude(v):\n    return sum(x * x for x in v) ** 0.5";
      area.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);

      const saved = window.localStorage.getItem("course-exercise:p01-l01")!;
      const lines = saved.split("\n");

      expect(saved).toContain("return sum(x * x for x in v) ** 0.5");
      // Соседи целы: docstring и заглушка следующей функции на месте.
      expect(saved).toContain("def dot(a, b):");
      expect(saved).toContain("Скалярное произведение");
      // Заглушка самой функции ушла, а не осталась второй копией.
      expect(saved).not.toContain("def magnitude(v):\n    \"\"\"Длина вектора.");
      // Между функциями остаётся ровно то же расстояние, что в шаблоне.
      const dotLine = lines.findIndex((line) => line.startsWith("def dot("));
      expect(lines.slice(dotLine - 2, dotLine)).toEqual(["", ""]);
    },
  );
});
