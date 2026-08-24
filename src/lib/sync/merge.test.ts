import { describe, expect, it } from "vitest";
import { mergeFile, mergeStep, mergeSteps, rankOf } from "./merge";

const early = "2026-08-01T10:00:00.000Z";
const late = "2026-08-02T10:00:00.000Z";

function step(stepId: string, state: "read" | "failed" | "passed", updatedAt: string) {
  return { lessonSlug: "lesson-a", stepId, state, updatedAt };
}

describe("rankOf", () => {
  it("ставит passed выше read и failed", () => {
    expect(rankOf("passed")).toBeGreaterThan(rankOf("read"));
    expect(rankOf("passed")).toBeGreaterThan(rankOf("failed"));
    expect(rankOf("read")).toBe(rankOf("failed"));
  });
});

describe("mergeStep", () => {
  it("возвращает единственную сторону, если второй нет", () => {
    expect(mergeStep(step("001", "read", early), null)?.state).toBe("read");
    expect(mergeStep(null, step("001", "passed", early))?.state).toBe("passed");
    expect(mergeStep(null, null)).toBeNull();
  });

  it("не сбрасывает сданный шаг красным прогоном с другого устройства", () => {
    const merged = mergeStep(step("001", "failed", late), step("001", "passed", early));
    expect(merged?.state).toBe("passed");
  });

  it("поднимает шаг до passed, откуда бы passed ни пришёл", () => {
    const merged = mergeStep(step("001", "passed", early), step("001", "read", late));
    expect(merged?.state).toBe("passed");
  });

  it("при равных рангах побеждает более позднее время", () => {
    const merged = mergeStep(step("001", "failed", late), step("001", "read", early));
    expect(merged?.state).toBe("failed");
    expect(merged?.updatedAt).toBe(late);
  });
});

describe("mergeSteps", () => {
  it("объединяет обе стороны и не теряет ни одного шага", () => {
    const { merged } = mergeSteps(
      [step("001", "read", early), step("002", "passed", early)],
      [step("002", "failed", late), step("003", "read", late)],
    );
    expect(merged.map((row) => row.stepId)).toEqual(["001", "002", "003"]);
    expect(merged.find((row) => row.stepId === "002")?.state).toBe("passed");
  });

  it("к отправке помечает только то, чего в облаке ещё нет или что там устарело", () => {
    const { upload } = mergeSteps(
      [step("001", "read", early), step("002", "passed", late), step("003", "read", early)],
      [step("002", "read", early), step("003", "read", early)],
    );
    expect(upload.map((row) => row.stepId).sort()).toEqual(["001", "002"]);
  });
});

describe("mergeFile", () => {
  const local = { slug: "ex", fileName: "exercise.py", content: "local" };
  const cloud = { slug: "ex", fileName: "exercise.py", content: "cloud", updatedAt: early };

  it("заливает локальный текст, когда в облаке строки нет", () => {
    expect(mergeFile(local, null)).toEqual({ action: "upload", row: local });
  });

  it("забирает облачный текст, когда локального нет", () => {
    expect(mergeFile(null, cloud)).toEqual({ action: "keep-cloud", row: cloud });
  });

  it("ничего не делает, когда тексты совпали", () => {
    const same = { ...local, content: "cloud" };
    expect(mergeFile(same, cloud)?.action).toBe("none");
  });

  it("без локальной отметки времени уступает облаку и откладывает копию", () => {
    const decision = mergeFile(local, cloud);
    expect(decision).toEqual({ action: "keep-cloud", row: cloud, backup: "local" });
  });

  it("с отметкой времени решает по ней", () => {
    const newer = { ...local, updatedAt: late };
    expect(mergeFile(newer, cloud)).toEqual({ action: "upload", row: newer });

    const older = { ...local, updatedAt: early };
    const fresherCloud = { ...cloud, updatedAt: late };
    expect(mergeFile(older, fresherCloud)).toEqual({ action: "keep-cloud", row: fresherCloud });
  });

  it("на двух пустых сторонах не решает ничего", () => {
    expect(mergeFile(null, null)).toBeNull();
  });
});
