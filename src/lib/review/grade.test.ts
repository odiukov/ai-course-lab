import { describe, expect, it } from "vitest";
import { gradeAuto, gradeSelf } from "./grade";

describe("gradeAuto", () => {
  it("верный ответ — это good", () => {
    expect(gradeAuto(true)).toBe("good");
  });

  it("неверный ответ — это again", () => {
    expect(gradeAuto(false)).toBe("again");
  });
});

describe("gradeSelf", () => {
  it("переносит три кнопки один в один", () => {
    expect(gradeSelf("again")).toBe("again");
    expect(gradeSelf("hard")).toBe("hard");
    expect(gradeSelf("easy")).toBe("easy");
  });
});
