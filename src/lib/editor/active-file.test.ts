import { describe, expect, it } from "vitest";
import { pickActiveFile } from "./active-file";

// Функции файлов не участвуют в этих сценариях — пустые списки достаточно,
// чтобы проверить приоритет stepFile / выбора человека / первого файла.
const NO_FUNCTIONS = [
  { name: "main.py", functions: [] },
  { name: "hooks.py", functions: [] },
];

describe("pickActiveFile", () => {
  it("открывает файл шага, когда шаг его называет", () => {
    expect(pickActiveFile(NO_FUNCTIONS, "hooks.py", undefined, null)).toBe("hooks.py");
  });

  it("уважает выбор человека, пока шаг не сменил файл", () => {
    // Человек открыл соседний таб, чтобы посмотреть каркас: переключать его
    // обратно на каждый ререндер нельзя.
    expect(pickActiveFile(NO_FUNCTIONS, undefined, undefined, "hooks.py")).toBe("hooks.py");
  });

  it("файл шага перебивает прежний выбор", () => {
    expect(pickActiveFile(NO_FUNCTIONS, "main.py", undefined, "hooks.py")).toBe("main.py");
  });

  it("падает на первый файл, когда ни шаг, ни человек ничего не выбрали", () => {
    expect(pickActiveFile(NO_FUNCTIONS, undefined, undefined, null)).toBe("main.py");
  });

  it("не отдаёт файл, которого больше нет в упражнении", () => {
    expect(
      pickActiveFile([{ name: "main.py", functions: [] }], "gone.py", undefined, "also-gone.py"),
    ).toBe("main.py");
  });

  it("владение файлом побеждает, когда шаг не назвал файл, а функция живёт не в первом", () => {
    const files = [
      { name: "main.py", functions: ["foo"] },
      { name: "hooks.py", functions: ["bar"] },
    ];
    expect(pickActiveFile(files, undefined, "bar", null)).toBe("hooks.py");
  });

  it("владение перебивает даже прежний выбор человека — на code-шаге маскировать функцию нельзя", () => {
    const files = [
      { name: "main.py", functions: ["foo"] },
      { name: "hooks.py", functions: ["bar"] },
    ];
    // Человек ранее открыл main.py посмотреть — но шагу нужен bar, и он
    // живёт в hooks.py: владение важнее старого выбора.
    expect(pickActiveFile(files, undefined, "bar", "main.py")).toBe("hooks.py");
  });

  it("явный файл шага остаётся первым приоритетом, даже если имя функции есть в обоих файлах", () => {
    const files = [
      { name: "main.py", functions: ["run"] },
      { name: "hooks.py", functions: ["run"] },
    ];
    expect(pickActiveFile(files, "hooks.py", "run", null)).toBe("hooks.py");
  });

  it("шаг без функции (теория) не трогает выбор человека, даже если функции объявлены", () => {
    const files = [
      { name: "main.py", functions: ["foo"] },
      { name: "hooks.py", functions: ["bar"] },
    ];
    expect(pickActiveFile(files, undefined, undefined, "hooks.py")).toBe("hooks.py");
  });
});
