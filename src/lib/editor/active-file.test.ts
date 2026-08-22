import { describe, expect, it } from "vitest";
import { pickActiveFile } from "./active-file";

describe("pickActiveFile", () => {
  it("открывает файл шага, когда шаг его называет", () => {
    expect(pickActiveFile(["main.py", "hooks.py"], "hooks.py", null)).toBe("hooks.py");
  });

  it("уважает выбор человека, пока шаг не сменил файл", () => {
    // Человек открыл соседний таб, чтобы посмотреть каркас: переключать его
    // обратно на каждый ререндер нельзя.
    expect(pickActiveFile(["main.py", "hooks.py"], undefined, "hooks.py")).toBe("hooks.py");
  });

  it("файл шага перебивает прежний выбор", () => {
    expect(pickActiveFile(["main.py", "hooks.py"], "main.py", "hooks.py")).toBe("main.py");
  });

  it("падает на первый файл, когда ни шаг, ни человек ничего не выбрали", () => {
    expect(pickActiveFile(["main.py", "hooks.py"], undefined, null)).toBe("main.py");
  });

  it("не отдаёт файл, которого больше нет в упражнении", () => {
    expect(pickActiveFile(["main.py"], "gone.py", "also-gone.py")).toBe("main.py");
  });
});
