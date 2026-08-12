import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLesson } from "../source/catalog";
import { readLessonSource } from "../source/lesson-source";
import type { WrittenFunction } from "../source/written-functions";
import type { StepMeta } from "./step-file";
import { isStale, readLessonPlan, validatePlan, writeLessonPlan, type LessonPlan } from "./lesson-plan";

const COURSE = path.resolve(__dirname, "../../../tests/fixtures/course");
const SOURCE = readLessonSource(COURSE, findLesson(COURSE, "01-math-foundations__02-beta")!);

function step(over: Partial<StepMeta> & Pick<StepMeta, "id" | "type">): StepMeta {
  return { title: over.id, ...over } as StepMeta;
}

const GOOD: StepMeta[] = [
  step({ id: "001-t", type: "theory" }),
  step({ id: "002-c", type: "code", exercise_fn: "transpose" }),
  step({ id: "003-t", type: "theory" }),
  step({ id: "004-c", type: "code", exercise_fn: "matmul" }),
];

describe("validatePlan", () => {
  it("принимает чередующийся план", () => {
    expect(validatePlan(GOOD, SOURCE)).toEqual([]);
  });

  it("ругается на два code-шага подряд без теории между ними", () => {
    const bad = [
      step({ id: "001-t", type: "theory" }),
      step({ id: "002-c", type: "code", exercise_fn: "transpose" }),
      step({ id: "003-c", type: "code", exercise_fn: "matmul" }),
    ];
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/подряд/);
  });

  it("ругается на неизвестную функцию", () => {
    const bad = [...GOOD, step({ id: "005-c", type: "code", exercise_fn: "nope" })];
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/nope/);
  });

  it("ругается на code-шаг без exercise_fn", () => {
    const bad = [step({ id: "001-t", type: "theory" }), step({ id: "002-c", type: "code" })];
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/exercise_fn/);
  });

  it("ругается на дубликаты id", () => {
    const bad = [step({ id: "001-t", type: "theory" }), step({ id: "001-t", type: "theory" })];
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/001-t/);
  });

  // Из id собирается имя файла шага, уточнения и схемы, а /api/visual берёт
  // его как сегмент — так что форму надо ловить в плане, а не в ридере.
  it.each(["004-длина", "004.dlina", "../../../etc/passwd", "a/b", "004 dlina", ""])(
    "ругается на id недопустимой формы: %s",
    (id) => {
      const bad = [...GOOD, step({ id, type: "theory" })];
      expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/имя файла/);
    },
  );

  it("не ругается на id вида 004-dlina", () => {
    expect(validatePlan(GOOD, SOURCE)).toEqual([]);
    expect(validatePlan([...GOOD, step({ id: "005_zachem-2", type: "theory" })], SOURCE)).toEqual([]);
  });

  it("требует покрыть все функции упражнения", () => {
    const bad = GOOD.slice(0, 2);
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/matmul/);
  });

  it("ругается на visual вне списка визуализаций урока", () => {
    const bad = [...GOOD, step({ id: "006-v", type: "visual", visual: "learning-visuals/nope.html" })];
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/nope\.html/);
  });

  const VISUAL = "learning-visuals/lesson-02-shapes.html";

  it("принимает visual-шаг с одним только путём", () => {
    const plan = [...GOOD, step({ id: "005-v", type: "visual", visual: VISUAL })];
    expect(validatePlan(plan, SOURCE)).toEqual([]);
  });

  it("принимает visual-шаг с одним только visual_brief", () => {
    const plan = [
      ...GOOD,
      step({ id: "005-v", type: "visual", visual_brief: "Треугольник 3-4-5, катеты 3 и 4 подписаны" }),
    ];
    expect(validatePlan(plan, SOURCE)).toEqual([]);
  });

  it("ругается, когда заданы и visual, и visual_brief", () => {
    const plan = [
      ...GOOD,
      step({ id: "005-v", type: "visual", visual: VISUAL, visual_brief: "то же самое" }),
    ];
    expect(validatePlan(plan, SOURCE).join(" ")).toMatch(/ровно одно/);
  });

  it("ругается на visual-шаг без пути и без брифа", () => {
    const plan = [...GOOD, step({ id: "005-v", type: "visual" })];
    expect(validatePlan(plan, SOURCE).join(" ")).toMatch(/ни visual, ни visual_brief/);
  });

  it("ругается на visual_brief у шага другого типа", () => {
    const plan = [...GOOD, step({ id: "005-t", type: "theory", visual_brief: "схема" })];
    expect(validatePlan(plan, SOURCE).join(" ")).toMatch(/никто не покажет/);
  });

  it("ругается, если все code-шаги свалены в конец после теории", () => {
    const bad = [
      step({ id: "001-t", type: "theory" }),
      step({ id: "002-t", type: "theory" }),
      step({ id: "003-t", type: "theory" }),
      step({ id: "004-c", type: "code", exercise_fn: "transpose" }),
      step({ id: "005-c", type: "code", exercise_fn: "matmul" }),
    ];
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/подряд/);
  });
});

describe("повторное написание функций", () => {
  const written: WrittenFunction[] = [
    {
      fn: "transpose",
      exerciseSlug: "p01-l02-beta",
      lessonSlug: "01-math-foundations__02-beta",
      signature: "transpose(M)",
    },
  ];

  it("не пускает пустой повтор уже написанной функции", () => {
    const errors = validatePlan(GOOD, SOURCE, written);
    expect(errors.join(" ")).toMatch(/transpose/);
    expect(errors.join(" ")).toMatch(/уже написан/);
  });

  it("пускает повтор, если указано, что изменилось", () => {
    const plan = GOOD.map((step) =>
      step.exercise_fn === "transpose"
        ? {
            ...step,
            baseline: {
              lesson: "01-math-foundations__02-beta",
              fn: "transpose",
              changes: "теперь без zip, вручную по индексам",
            },
          }
        : step,
    );
    expect(validatePlan(plan, SOURCE, written)).toEqual([]);
  });

  it("пускает recall-шаг вместо повторного задания", () => {
    const plan = GOOD.map((step) =>
      step.exercise_fn === "transpose" ? { ...step, type: "recall" as const } : step,
    );
    expect(validatePlan(plan, SOURCE, written)).toEqual([]);
  });

  // Так планировщик и ошибался на уроке про матричные преобразования: в конце
  // урока он ставил recall-шаг «ваш compose — это стек слоёв нейросети», то
  // есть отсылку к функции, которую человек написал парой десятков шагов
  // выше, в этом же уроке.
  it("не пускает recall про функцию, которую человек ещё не писал", () => {
    const plan = GOOD.map((item) =>
      item.exercise_fn === "matmul" ? { ...item, type: "recall" as const } : item,
    );
    expect(validatePlan(plan, SOURCE, written).join(" ")).toMatch(/ещё не писал/);
  });

  // Тот же промах, но recall стоит ДОПОЛНИТЕЛЬНО к code-шагу, а не вместо
  // него: практика на месте, зато карточке recall нечего показать.
  it("не пускает recall рядом с code-шагом на ту же функцию", () => {
    const plan = [...GOOD, step({ id: "005-recall-matmul", type: "recall", exercise_fn: "matmul" })];
    expect(validatePlan(plan, SOURCE, written).join(" ")).toMatch(/уже занята/);
  });

  it("без реестра ведёт себя как раньше", () => {
    expect(validatePlan(GOOD, SOURCE)).toEqual([]);
  });
});

describe("чтение и запись", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lab-"));
  const plan: LessonPlan = {
    slug: "01-math-foundations__02-beta",
    title: "Beta",
    lang: "ru",
    sourcePath: SOURCE.textPath,
    sourceHash: SOURCE.sourceHash,
    generatedAt: "2026-08-09T00:00:00.000Z",
    steps: GOOD,
  };

  it("возвращает null, если плана нет", () => {
    expect(readLessonPlan(tmp, "01-math-foundations__02-beta")).toBeNull();
  });

  it("пишет и читает обратно", () => {
    writeLessonPlan(tmp, plan);
    expect(readLessonPlan(tmp, plan.slug)).toEqual(plan);
  });

  it("считает план протухшим при смене хеша", () => {
    expect(isStale(plan, SOURCE)).toBe(false);
    expect(isStale({ ...plan, sourceHash: "beef" }, SOURCE)).toBe(true);
  });
});

describe("validatePlan — ориентир по числу шагов", () => {
  // Урок без упражнения: план из одной теории иначе спотыкался бы о правило
  // «каждая функция получает свой code-шаг», а проверяем мы здесь длину.
  const SOURCE_NO_EXERCISE = { ...SOURCE, exercise: null };

  function steps(n: number): StepMeta[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `${String(i + 1).padStart(3, "0")}-t`,
      type: "theory" as const,
      title: `Шаг ${i + 1}`,
    }));
  }

  it("без ориентира длину не проверяет", () => {
    expect(validatePlan(steps(54), SOURCE_NO_EXERCISE)).toEqual([]);
  });

  it("попадание в ориентир и отклонение в пределах четверти проходят", () => {
    expect(validatePlan(steps(40), SOURCE_NO_EXERCISE, [], 40)).toEqual([]);
    expect(validatePlan(steps(50), SOURCE_NO_EXERCISE, [], 40)).toEqual([]);
    expect(validatePlan(steps(30), SOURCE_NO_EXERCISE, [], 40)).toEqual([]);
  });

  // Настоящий случай: ориентир 40, планировщик прислал 54.
  it("отвергает план, ушедший далеко за ориентир", () => {
    const errors = validatePlan(steps(54), SOURCE_NO_EXERCISE, [], 40);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("54");
    expect(errors[0]).toContain("40");
    expect(errors[0]).toContain("больше");
  });

  it("слишком короткий план отвергается так же", () => {
    const errors = validatePlan(steps(20), SOURCE_NO_EXERCISE, [], 40);
    expect(errors[0]).toContain("меньше");
  });
});
