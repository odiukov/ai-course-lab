import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bookFilename } from "../src/lib/book/build";

const root = process.cwd();
const repo = process.env.SITE_GITHUB_REPO ?? "odiukov/ai-course-lab";
const tag = "book-latest";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "course-book-release-"));
const pdf = path.join(tempDir, bookFilename(null));

function gh(args: string[], stdio: "ignore" | "inherit" = "inherit"): void {
  execFileSync("gh", ["--repo", repo, ...args], { cwd: root, stdio });
}

try {
  execFileSync(
    process.execPath,
    [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "scripts/build-book.mts"), pdf],
    { cwd: root, stdio: "inherit" },
  );

  let exists = true;
  try {
    gh(["release", "view", tag], "ignore");
  } catch {
    exists = false;
  }

  if (exists) {
    gh(["release", "upload", tag, pdf, "--clobber"]);
  } else {
    gh([
      "release",
      "create",
      tag,
      pdf,
      "--target",
      "gh-pages",
      "--title",
      "AI Engineering — полная PDF-книга",
      "--notes",
      "Автоматически собранная версия курса без квизов и интерактивной практики.",
    ]);
  }
  console.log(`Книга опубликована в релиз ${repo}@${tag}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
