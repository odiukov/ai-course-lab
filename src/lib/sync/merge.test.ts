import { describe, expect, it } from "vitest";
import { mergeCard, mergeCards, mergeFile, mergeStep, mergeSteps, rankOf, type CardRow } from "./merge";

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

  it("не отправляет строку, у которой разошлась одна отметка времени", () => {
    // Отметку прочитанному шагу подставляет разбор локального хранилища:
    // времени у него нет. Сверка по ней означала бы, что каждый переход между
    // страницами переотправляет в облако всю историю чтения целиком.
    const { upload } = mergeSteps([step("001", "read", late)], [step("001", "read", early)]);
    expect(upload).toEqual([]);
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
    expect(mergeFile(older, fresherCloud)?.action).toBe("keep-cloud");
  });

  it("откладывает копию и тогда, когда локальная отметка времени есть", () => {
    // Отметка времени пишется на каждое нажатие клавиши, в том числе до
    // всякого входа. Человек, печатавший здесь до первого входа, без копии
    // терял бы написанное молча — оно затиралось бы прямо в localStorage.
    const older = { ...local, updatedAt: early };
    const fresherCloud = { ...cloud, updatedAt: late };
    expect(mergeFile(older, fresherCloud)).toEqual({
      action: "keep-cloud",
      row: fresherCloud,
      backup: "local",
    });
  });

  it("на двух пустых сторонах не решает ничего", () => {
    expect(mergeFile(null, null)).toBeNull();
  });
});

function row(over: Partial<CardRow> = {}): CardRow {
  return {
    lessonSlug: "01-alpha",
    cardId: "s-1",
    state: {
      intervalDays: 6,
      ease: 2.5,
      reps: 2,
      lapses: 0,
      dueOn: "2026-09-02",
      fingerprint: "abcd1234",
      updatedAt: "2026-08-26T10:00:00.000Z",
    },
    ...over,
  };
}

function at(time: string, over: Partial<CardRow["state"]> = {}): CardRow {
  return row({ state: { ...row().state, updatedAt: time, ...over } });
}

describe("mergeCard", () => {
  it("одна сторона пуста — берётся другая", () => {
    expect(mergeCard(row(), null, "abcd1234")).toEqual(row());
    expect(mergeCard(null, row(), "abcd1234")).toEqual(row());
  });

  it("побеждает свежая запись", () => {
    const local = at("2026-08-26T12:00:00.000Z", { intervalDays: 30 });
    const cloud = at("2026-08-26T10:00:00.000Z", { intervalDays: 3 });
    expect(mergeCard(local, cloud, "abcd1234")?.state.intervalDays).toBe(30);
  });

  it("при равенстве времён побеждает меньший интервал", () => {
    const local = at("2026-08-26T10:00:00.000Z", { intervalDays: 30 });
    const cloud = at("2026-08-26T10:00:00.000Z", { intervalDays: 3 });
    expect(mergeCard(local, cloud, "abcd1234")?.state.intervalDays).toBe(3);
  });

  it("отбрасывает состояние с чужим отпечатком", () => {
    expect(mergeCard(row(), null, "ffff0000")).toBeNull();
  });

  it("отбрасывает обе стороны, если карточку переписали", () => {
    expect(mergeCard(row(), row(), "ffff0000")).toBeNull();
  });
});

describe("mergeCards", () => {
  it("сводит списки по паре урок плюс карточка", () => {
    const local = [row(), row({ cardId: "s-2" })];
    const cloud = [row({ cardId: "s-3" })];
    const merged = mergeCards(local, cloud, {
      "01-alpha/s-1": "abcd1234",
      "01-alpha/s-2": "abcd1234",
      "01-alpha/s-3": "abcd1234",
    });
    expect(merged.map((item) => item.cardId).sort()).toEqual(["s-1", "s-2", "s-3"]);
  });

  it("выбрасывает карточку, которой больше нет в файлах", () => {
    const merged = mergeCards([row({ cardId: "s-9" })], [], {});
    expect(merged).toEqual([]);
  });
});
