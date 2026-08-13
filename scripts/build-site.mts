// Сборка статического сайта курса: текст шагов и схемы, без редактора, агента
// и прогресса.
//
// Запуск: npm run site:build   (BASE_PATH=... переопределяет префикс адресов)
//
// Читает content/lessons на месте и ничего в рабочей копии не меняет: уроки
// дописываются параллельно, и сборка обязана быть просто срезом того, что
// лежит на диске сию секунду.
import fs from "node:fs";
import path from "node:path";
import { withHeightReporter } from "../src/lib/api/visual-height.js";
import { readLessonPlan } from "../src/lib/content/lesson-plan.js";
import { readStepsById } from "../src/lib/content/step-file.js";
import { groupLessons, type CatalogLesson } from "../src/lib/site/catalog.js";
import { buildLessonModel } from "../src/lib/site/lesson-page.js";
import { renderIndexPage, renderLessonPage } from "../src/lib/site/render.js";
import { collectVisualRefs } from "../src/lib/site/visual-refs.js";

const root = process.cwd();
const contentDir = path.join(root, "content");
const sourceDir = path.join(root, "source");
const outDir = path.join(root, "out");
const basePath = (process.env.BASE_PATH ?? "/ai-course-lab").replace(/\/$/, "");

// Та же политика, что шлёт заголовком /api/visual. GitHub Pages произвольные
// заголовки не отдаёт, поэтому запрет едет внутри самого файла схемы.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

function write(relPath: string, content: string): void {
  const target = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

/** Подшивает к схеме мерку высоты и политику CSP первым тегом в head. */
function prepareVisual(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  const head = html.toLowerCase().indexOf("<head>");
  const withMeta =
    head === -1 ? `${meta}\n${html}` : `${html.slice(0, head + 6)}\n${meta}${html.slice(head + 6)}`;
  return withHeightReporter(withMeta);
}

function copyKatexAssets(): void {
  const katexDir = path.join(root, "node_modules", "katex", "dist");
  fs.mkdirSync(path.join(outDir, "assets", "katex"), { recursive: true });
  fs.copyFileSync(
    path.join(katexDir, "katex.min.css"),
    path.join(outDir, "assets", "katex", "katex.min.css"),
  );
  fs.cpSync(path.join(katexDir, "fonts"), path.join(outDir, "assets", "katex", "fonts"), {
    recursive: true,
  });
}

function buildSiteCss(): string {
  // theme.css вклеивается в site.css вручную: обычный @import остался бы
  // ссылкой на файл, которого в out/ нет.
  const styles = path.join(root, "src", "styles");
  const site = fs.readFileSync(path.join(styles, "site.css"), "utf8");
  const theme = fs.readFileSync(path.join(styles, "theme.css"), "utf8");
  return site.replace(/@import\s+"\.\/theme\.css";\s*/, `${theme}\n`);
}

function lessonSlugs(): string[] {
  const lessonsDir = path.join(contentDir, "lessons");
  if (!fs.existsSync(lessonsDir)) return [];
  return fs
    .readdirSync(lessonsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function main(): void {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const catalog: CatalogLesson[] = [];
  let renderedSteps = 0;
  let missingSteps = 0;
  let copiedVisuals = 0;
  let skippedLessons = 0;

  for (const slug of lessonSlugs()) {
    let plan;
    try {
      plan = readLessonPlan(contentDir, slug);
    } catch (error) {
      console.warn(`· ${slug}: план не читается, урок пропущен (${(error as Error).message})`);
      skippedLessons += 1;
      continue;
    }
    if (!plan) continue;

    const written = readStepsById(
      contentDir,
      slug,
      plan.steps.map((step) => step.id),
    );
    const { refs, hrefByStepId } = collectVisualRefs({
      steps: plan.steps,
      slug,
      contentDir,
      sourceDir,
      basePath,
    });

    for (const ref of refs) {
      write(ref.outRelPath, prepareVisual(fs.readFileSync(ref.sourcePath, "utf8")));
      copiedVisuals += 1;
    }

    const model = buildLessonModel({
      slug,
      title: plan.title,
      steps: plan.steps,
      written,
      visualHrefByStepId: hrefByStepId,
    });

    write(path.join("lesson", slug, "index.html"), renderLessonPage(model, { basePath }));

    renderedSteps += model.writtenCount;
    missingSteps += model.plannedCount - model.writtenCount;
    catalog.push({
      slug,
      title: plan.title,
      number: Number(/__(\d{2})-/.exec(slug)?.[1] ?? 0),
      writtenCount: model.writtenCount,
      plannedCount: model.plannedCount,
    });
  }

  write("index.html", renderIndexPage(groupLessons(catalog), { basePath }));
  write("assets/site.css", buildSiteCss());
  // Без .nojekyll Pages прогоняет вывод через Jekyll и выбрасывает всё, что
  // начинается с подчёркивания.
  write(".nojekyll", "");
  copyKatexAssets();

  console.log(
    `Собрано: уроков ${catalog.length}, шагов ${renderedSteps}, ` +
      `не написано ${missingSteps}, схем ${copiedVisuals}` +
      (skippedLessons > 0 ? `, пропущено уроков ${skippedLessons}` : ""),
  );
}

main();
