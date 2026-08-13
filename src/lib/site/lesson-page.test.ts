import { describe, expect, it } from "vitest";
import type { Step, StepMeta } from "../content/step-file";
import { buildLessonModel } from "./lesson-page";

const plan: StepMeta[] = [
  { id: "001-a", type: "theory", title: "Первый" },
  { id: "002-b", type: "theory", title: "Второй" },
  { id: "003-c", type: "visual", title: "Третий", visual_brief: "схема" },
  { id: "004-d", type: "code", title: "Четвёртый", exercise_fn: "dot" },
];

function written(ids: string[]): Record<string, Step> {
  return Object.fromEntries(
    ids.map((id) => {
      const meta = plan.find((item) => item.id === id)!;
      return [id, { ...meta, body: `тело ${id}` } as Step];
    }),
  );
}

function build(ids: string[], visuals: Record<string, string> = {}) {
  return buildLessonModel({
    slug: "lesson-a",
    title: "Урок",
    steps: plan,
    written: written(ids),
    visualHrefByStepId: visuals,
  });
}

describe("buildLessonModel", () => {
  it("keeps plan order and numbering when a step in the middle is missing", () => {
    // Дырка в середине — обычное состояние: урок дописывается прямо сейчас.
    // Четвёртый шаг обязан остаться четвёртым, а не подняться на место
    // ненаписанного третьего.
    const model = build(["001-a", "002-b", "004-d"]);

    expect(model.blocks.map((block) => block.step.id)).toEqual(["001-a", "002-b", "004-d"]);
    expect(model.blocks.map((block) => block.number)).toEqual([1, 2, 4]);
    expect(model.writtenCount).toBe(3);
    expect(model.plannedCount).toBe(4);
  });

  it("exposes the full plan order for step links", () => {
    const model = build(["001-a"]);

    expect(model.stepIds).toEqual(["001-a", "002-b", "003-c", "004-d"]);
  });

  it("mounts a visual only when the file exists", () => {
    const withFile = build(["003-c"], { "003-c": "/base/visuals/lesson-a/003-c.html" });
    const withoutFile = build(["003-c"]);

    expect(withFile.blocks[0].visualHref).toBe("/base/visuals/lesson-a/003-c.html");
    expect(withoutFile.blocks[0].visualHref).toBeNull();
  });

  it("carries the exercise function of a practice step", () => {
    const model = build(["004-d"]);

    expect(model.blocks[0].practiceFn).toBe("dot");
  });
});
