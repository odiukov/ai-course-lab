import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { completePdf } from "./pdf";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("completePdf", () => {
  it("distinguishes finished output from an empty or truncated file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "complete-pdf-test-"));
    roots.push(root);
    const file = path.join(root, "book.pdf");

    fs.writeFileSync(file, "");
    expect(completePdf(file)).toBe(false);
    fs.writeFileSync(file, "%PDF-1.4\ntruncated");
    expect(completePdf(file)).toBe(false);
    fs.writeFileSync(file, "%PDF-1.4\nbody\n%%EOF\n");
    expect(completePdf(file)).toBe(true);
  });
});
