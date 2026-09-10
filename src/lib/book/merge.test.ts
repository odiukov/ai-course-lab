import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { mergeBookPdfs } from "./merge";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("mergeBookPdfs", () => {
  it("combines phase documents into one page sequence", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "book-merge-test-"));
    roots.push(root);
    const files: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const document = await PDFDocument.create();
      document.addPage([595, 842]);
      const file = path.join(root, `phase-${index}.pdf`);
      fs.writeFileSync(file, await document.save());
      files.push(file);
    }

    const merged = await PDFDocument.load(await mergeBookPdfs(files));
    expect(merged.getPageCount()).toBe(2);
    expect(merged.getTitle()).toBe("AI Engineering from Scratch");
  });
});
