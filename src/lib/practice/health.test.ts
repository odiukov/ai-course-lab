import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { probeCommand } from "./health";

const FAKE = path.join(process.cwd(), "tests/fixtures/practice/fake-python.mjs");

describe("probeCommand", () => {
  it("успешный запуск — ok", async () => {
    expect(await probeCommand(FAKE, ["--version"])).toMatchObject({ ok: true });
  });

  it("отсутствующая команда — не ok, с причиной", async () => {
    const status = await probeCommand(path.join(os.tmpdir(), "no-such-binary"), ["--version"]);
    expect(status.ok).toBe(false);
    expect(status.detail.length).toBeGreaterThan(0);
  });

  it("зависшая команда не держит проверку дольше таймаута", async () => {
    process.env.FAKE_PYTHON_MODE = "hang";
    const status = await probeCommand(FAKE, ["--version"], 200);
    delete process.env.FAKE_PYTHON_MODE;
    expect(status.ok).toBe(false);
    expect(status.detail).toMatch(/таймаут/i);
  });
});
