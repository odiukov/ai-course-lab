import { describe, expect, it } from "vitest";
import path from "node:path";
import { claudeAdapter } from "./claude-adapter";
import type { Adapter, AgentEvent } from "./events";
import { queueDepth, runAgent, runQueued } from "./runner";

const FAKE = path.resolve(__dirname, "../../../tests/fixtures/agent/fake-agent.mjs");

const fakeAdapter: Adapter = {
  command: process.execPath,
  args: (prompt) => [FAKE, prompt],
  parseLine: claudeAdapter.parseLine,
};

describe("runAgent", () => {
  it("отдаёт текстовые события по мере поступления и возвращает итог", async () => {
    const events: AgentEvent[] = [];
    const text = await runAgent({ adapter: fakeAdapter, prompt: "ok" }, (e) => events.push(e));
    expect(text).toBe("часть 1 часть 2");
    expect(events.filter((e) => e.type === "text")).toHaveLength(2);
  });

  it("реджектится на ошибке агента", async () => {
    await expect(runAgent({ adapter: fakeAdapter, prompt: "FAIL" }, () => {}))
      .rejects.toThrow(/boom/);
  });

  it("отличает лимит подписки от прочих ошибок", async () => {
    await expect(runAgent({ adapter: fakeAdapter, prompt: "LIMIT" }, () => {}))
      .rejects.toThrow(/лимит/i);
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
