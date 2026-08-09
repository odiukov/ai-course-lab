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
