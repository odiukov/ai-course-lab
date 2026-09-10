import fs from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Merge phase PDFs and replace their local footer numbers with global ones. */
export async function mergeBookPdfs(files: string[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(fs.readFileSync(file));
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  const font = await merged.embedFont(StandardFonts.Helvetica);
  const color = rgb(0.58, 0.64, 0.72);
  merged.getPages().forEach((page, index) => {
    const label = `AI Engineering · ${index + 1}`;
    const size = 8;
    const width = font.widthOfTextAtSize(label, size);
    page.drawRectangle({
      x: page.getWidth() - 175,
      y: 0,
      width: 175,
      height: 35,
      color: rgb(1, 1, 1),
    });
    page.drawText(label, {
      x: page.getWidth() - 51 - width,
      y: 14,
      size,
      font,
      color,
    });
  });

  merged.setTitle("AI Engineering from Scratch");
  merged.setSubject("Теория и готовые реализации");
  merged.setCreator("AI Course Lab");
  return merged.save({ useObjectStreams: true });
}
