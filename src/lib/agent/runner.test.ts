import { describe, expect, it } from "vitest";
import path from "node:path";
import { claudeAdapter } from "./claude-adapter";
import type { Adapter, AgentEvent } from "./events";
import { AgentRunError, queueDepth, runAgent, runQueued } from "./runner";

const FAKE = path.resolve(__dirname, "../../../tests/fixtures/agent/fake-agent.mjs");

const fakeAdapter: Adapter = {
  command: process.execPath,
  args: (prompt) => [FAKE, prompt],
  parseLine: claudeAdapter.parseLine,
};

// Wraps claudeAdapter's real parser but throws for one specific line, to
// simulate a malformed-but-valid-JSON payload with an unexpected shape
// (e.g. `content` not being an array) rather than a JSON parse failure.
const throwingAdapter: Adapter = {
  command: process.execPath,
  args: (prompt) => [FAKE, prompt],
  parseLine(line) {
    if (line.includes("часть 1")) {
      throw new TypeError("content.filter is not a function");
    }
    return claudeAdapter.parseLine(line);
  },
};

describe("runAgent", () => {
  it("отдаёт текстовые события по мере поступления и возвращает итог", async () => {
    const events: AgentEvent[] = [];
    const text = await runAgent({ adapter: fakeAdapter, prompt: "ok" }, (e) => events.push(e));
    expect(text).toBe("часть 1 часть 2");
    expect(events.filter((e) => e.type === "text")).toHaveLength(2);
  });

  it("реджектится на ошибке агента", async () => {
    const promise = runAgent({ adapter: fakeAdapter, prompt: "FAIL" }, () => {});
    await expect(promise).rejects.toThrow(/boom/);
    await expect(promise).rejects.toMatchObject({ kind: "agent" });
  });

  it("отличает лимит подписки от прочих ошибок", async () => {
    const promise = runAgent({ adapter: fakeAdapter, prompt: "LIMIT" }, () => {});
    await expect(promise).rejects.toThrow(/лимит/i);
    await expect(promise).rejects.toMatchObject({ kind: "limit" });
  });

  it("реджектится, а не валит процесс, если parseLine выбрасывает исключение", async () => {
    const promise = runAgent({ adapter: throwingAdapter, prompt: "ok" }, () => {});
    await expect(promise).rejects.toBeInstanceOf(AgentRunError);
    await expect(promise).rejects.toMatchObject({ kind: "parse" });
  });

  it("отличает отмену через AbortSignal от неудачного запуска", async () => {
    const controller = new AbortController();
    const promise = runAgent(
      { adapter: fakeAdapter, prompt: "ok", signal: controller.signal },
      () => {},
    );
    controller.abort();

    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AgentRunError);
    const error = caught as AgentRunError;
    expect(error.kind).toBe("aborted");
    expect(error.message).not.toMatch(/не удалось запустить/i);
  });
});

describe("runQueued", () => {
  it("выполняет запуски строго по одному", async () => {
    const order: string[] = [];
    const first = runQueued({ adapter: fakeAdapter, prompt: "a" }, () => order.push("a"));
    const second = runQueued({ adapter: fakeAdapter, prompt: "b" }, () => order.push("b"));
    expect(queueDepth()).toBeGreaterThan(0);
    await Promise.all([first, second]);
    const firstB = order.indexOf("b");
    const lastA = order.lastIndexOf("a");
    expect(lastA).toBeLessThan(firstB);
    expect(queueDepth()).toBe(0);
  });

  it("продолжает очередь после отказа предыдущего запуска", async () => {
    const failing = runQueued({ adapter: fakeAdapter, prompt: "FAIL" }, () => {});
    const succeeding = runQueued({ adapter: fakeAdapter, prompt: "ok" }, () => {});

    await expect(failing).rejects.toThrow(/boom/);
    await expect(succeeding).resolves.toBe("часть 1 часть 2");
    expect(queueDepth()).toBe(0);
  });
});
