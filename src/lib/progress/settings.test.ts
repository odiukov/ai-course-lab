import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeProgressDb, execute, openProgressDb } from "./db";
import { isAgentName, readAgent, writeAgent } from "./settings";

let dataDir = "";

function open() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-settings-"));
  return openProgressDb(dataDir);
}

afterEach(() => {
  if (dataDir) closeProgressDb(dataDir);
});

describe("readAgent / writeAgent", () => {
  it("без выбора отдаёт значение из окружения", () => {
    const db = open();
    expect(readAgent(db, "claude")).toBe("claude");
    expect(readAgent(db, "codex")).toBe("codex");
  });

  it("запомненный выбор перебивает окружение", () => {
    const db = open();
    writeAgent(db, "codex");
    expect(readAgent(db, "claude")).toBe("codex");
  });

  it("повторная запись заменяет прежний выбор, а не копит строки", () => {
    const db = open();
    writeAgent(db, "codex");
    writeAgent(db, "claude");
    expect(readAgent(db, "codex")).toBe("claude");
  });

  // Единственный способ получить сюда третье значение — правка базы руками.
  // Ронять из-за неё запрос к чату хуже, чем взять AGENT из окружения.
  it("мусор в таблице читается как отсутствие выбора", () => {
    const db = open();
    execute(db, "INSERT INTO settings (key, value) VALUES ('agent', ?)", "gpt");
    expect(readAgent(db, "claude")).toBe("claude");
  });
});

describe("isAgentName", () => {
  it("пропускает только два известных имени", () => {
    expect(isAgentName("claude")).toBe(true);
    expect(isAgentName("codex")).toBe(true);
    expect(isAgentName("gpt")).toBe(false);
    expect(isAgentName("")).toBe(false);
    expect(isAgentName(undefined)).toBe(false);
  });
});
