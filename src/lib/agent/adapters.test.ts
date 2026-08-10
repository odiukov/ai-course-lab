import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { claudeAdapter } from "./claude-adapter";
import { codexAdapter } from "./codex-adapter";
import { collectText, isLimitMessage, type AgentEvent } from "./events";

const FIXTURES = path.resolve(__dirname, "../../../tests/fixtures/agent");

function replay(adapter: { parseLine(line: string): AgentEvent[] }, file: string): AgentEvent[] {
  return fs
    .readFileSync(path.join(FIXTURES, file), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => adapter.parseLine(line));
}

describe.each([
  ["claude", claudeAdapter, "claude-stream.jsonl"],
  ["codex", codexAdapter, "codex-stream.jsonl"],
])("%s", (_name, adapter, file) => {
  it("достаёт из записанного стрима текст ответа", () => {
    const events = replay(adapter, file);
    expect(collectText(events).toLowerCase()).toContain("готово");
  });

  it("выдаёт ровно одно событие done", () => {
    expect(replay(adapter, file).filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("молча пропускает мусорные строки", () => {
    expect(adapter.parseLine("не json вовсе")).toEqual([]);
    expect(adapter.parseLine("")).toEqual([]);
  });

  it("строит команду с промптом", () => {
    expect(adapter.args("привет")).toContain("привет");
  });
});

describe("claude, поток с частичными сообщениями", () => {
  // Записано настоящим `claude ... --include-partial-messages`; выкинуты только
  // строки хуков SessionStart — они про машину, где шла запись, а не про формат.
  it("собирает ответ из дельт и не задваивает его строкой assistant", () => {
    const events = replay(claudeAdapter, "claude-partial-stream.jsonl");
    const streamed = events
      .filter((event): event is Extract<AgentEvent, { type: "text" }> => event.type === "text")
      .map((event) => event.text);

    expect(streamed).toEqual(["гот", "ово"]);
    expect(streamed.join("")).toBe(collectText(events));
  });

  it("просит у CLI частичные сообщения, иначе ответ появляется целиком", () => {
    expect(claudeAdapter.args("привет")).toContain("--include-partial-messages");
  });
});

describe("ограничение инструментов", () => {
  it("claude запускается без единого инструмента и без чужих MCP", () => {
    const args = claudeAdapter.args("привет");
    // Проверено на claude 2.1.226: строка init приходит с "tools":[] и
    // "mcp_servers":[].
    expect(args).toContain("--tools");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).toContain("--strict-mcp-config");
  });

  it("codex запускается без шелла, браузера и компьютера", () => {
    const args = codexAdapter.args("привет");
    // Проверено на codex-cli 0.147.0: эти три фичи стабильны и включены по
    // умолчанию, а живой запуск со всеми тремя выключенными всё равно отвечает.
    const disabled = args.filter((_, i) => args[i - 1] === "--disable");
    expect(disabled).toEqual(["shell_tool", "browser_use", "computer_use"]);
    // Песочница остаётся вторым рубежом, а не единственным.
    expect(args).toContain("-s");
    expect(args[args.indexOf("-s") + 1]).toBe("read-only");
    expect(args).toContain("--skip-git-repo-check");
    // Промпт остаётся последним позиционным аргументом.
    expect(args.at(-1)).toBe("привет");
  });
});

describe("collectText", () => {
  it("берёт последний непустой done, а не первый", () => {
    // Многоходовой `codex exec` шлёт по done на каждое завершённое сообщение
    // агента. Первое — «сейчас посмотрю урок», последнее — собственно ответ.
    const events: AgentEvent[] = [
      { type: "done", text: "Сейчас посмотрю урок." },
      { type: "done", text: "Ещё думаю." },
      { type: "done", text: '```json\n[{"id":"001-a"}]\n```' },
    ];
    expect(collectText(events)).toContain('"001-a"');
  });

  it("пропускает пустые done и берёт последний осмысленный", () => {
    const events: AgentEvent[] = [
      { type: "done", text: "первый" },
      { type: "done", text: "второй" },
      { type: "done", text: "   " },
    ];
    expect(collectText(events)).toBe("второй");
  });

  it("без done склеивает текстовые события", () => {
    const events: AgentEvent[] = [
      { type: "text", text: "часть 1 " },
      { type: "text", text: "часть 2" },
    ];
    expect(collectText(events)).toBe("часть 1 часть 2");
  });
});

describe("распознавание лимита", () => {
  it("помечает сообщение про лимит отдельным типом", () => {
    const events = claudeAdapter.parseLine(
      JSON.stringify({ type: "result", is_error: true, result: "Claude AI usage limit reached" }),
    );
    expect(events[0].type).toBe("limit");
  });

  it("не помечает лимитом успешный прогон, где встретился rate_limit_event", () => {
    const events = replay(claudeAdapter, "claude-stream.jsonl");
    expect(events.filter((e) => e.type === "limit")).toHaveLength(0);
  });

  it("claude: обычная ошибка без лимитной формулировки даёт тип error, не limit", () => {
    const events = claudeAdapter.parseLine(
      JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        result: "Внутренняя ошибка агента",
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "error", message: "Внутренняя ошибка агента" });
  });

  // codex's error/limit branch was never observed in the Task 7 recording (no codex
  // error occurred); these two tests pin down the *code's* current behaviour against
  // the shape claude-adapter's error branch already expects, they do not confirm that
  // shape against real CLI output.
  it("codex: обычная ошибка даёт тип error", () => {
    const events = codexAdapter.parseLine(JSON.stringify({ type: "error", error: "Внутренняя ошибка агента" }));
    expect(events).toEqual([{ type: "error", message: "Внутренняя ошибка агента" }]);
  });

  it("codex: ошибка с лимитной формулировкой даёт тип limit", () => {
    const events = codexAdapter.parseLine(JSON.stringify({ type: "error", error: "Codex usage limit reached" }));
    expect(events).toEqual([{ type: "limit", message: "Codex usage limit reached" }]);
  });

  it("isLimitMessage: обычная ошибка — не лимит", () => {
    expect(isLimitMessage("Внутренняя ошибка агента")).toBe(false);
  });

  it("isLimitMessage: реальная формулировка лимита распознаётся", () => {
    expect(isLimitMessage("Claude AI usage limit reached")).toBe(true);
  });
});
