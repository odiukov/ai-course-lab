// Сборка статического сайта курса: текст шагов и схемы, без редактора, агента
// и прогресса.
//
// Запуск: npm run site:build   (BASE_PATH=... переопределяет префикс адресов)
//
// Читает content/lessons на месте и ничего в рабочей копии не меняет: уроки
// дописываются параллельно, и сборка обязана быть просто срезом того, что
// лежит на диске сию секунду.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { withHeightReporter } from "../src/lib/api/visual-height.js";
import {
  exerciseFiles,
  exerciseUrls,
  findLessonExercise,
  type ExerciseBundle,
} from "../src/lib/site/exercise.js";
import { readLessonPlan } from "../src/lib/content/lesson-plan.js";
import { readStepsById } from "../src/lib/content/step-file.js";
import { groupLessons, type CatalogLesson } from "../src/lib/site/catalog.js";
import { buildLessonModel } from "../src/lib/site/lesson-page.js";
import {
  renderIndexPage,
  renderLessonIndexPage,
  renderStepPage,
} from "../src/lib/site/render.js";
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

/**
 * Python для браузера — рядом с сайтом, а не с чужого CDN.
 *
 * Из пакета нужны только эти пять файлов: ядро, стандартная библиотека и
 * список пакетов. Всё остальное в дистрибутиве — предсобранные numpy и прочие,
 * которых упражнениям курса не требуется.
 */
function copyPyodide(): void {
  const from = path.join(root, "node_modules", "pyodide");
  const to = path.join(outDir, "assets", "pyodide");
  fs.mkdirSync(to, { recursive: true });
  for (const name of [
    "pyodide.js",
    "pyodide.asm.js",
    "pyodide.asm.mjs",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
  ]) {
    const file = path.join(from, name);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(to, name));
  }
}

/** Редактор кода одним файлом: CodeMirror собирается esbuild-ом. */
async function buildEditor(): Promise<void> {
  await build({
    entryPoints: [path.join(root, "src", "site-editor", "editor.ts")],
    outfile: path.join(outDir, "assets", "editor.js"),
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2019",
    logLevel: "warning",
  });
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

async function main(): Promise<void> {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const catalog: CatalogLesson[] = [];
  // Модели копятся первым проходом, страницы пишутся вторым: ссылка «следующий
  // урок» существует только после того, как известен порядок всех уроков.
  const models = new Map<string, ReturnType<typeof buildLessonModel>>();
  const exercises = new Map<string, ExerciseBundle>();
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

    models.set(slug, model);

    // Упражнение копируется целиком: заготовка, тесты и эталон. Тесты
    // импортируют из файла все функции сразу, поэтому в браузере должен
    // лежать весь файл, а не одна функция шага.
    const exercise = findLessonExercise(sourceDir, slug);
    if (exercise) {
      exercises.set(slug, exercise);
      for (const file of exerciseFiles(exercise)) {
        write(file.to, fs.readFileSync(file.from, "utf8"));
      }
    }

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

  const phases = groupLessons(catalog);
  // Порядок курса — как в каталоге: фаза за фазой, урок за уроком. Он же
  // отвечает на вопрос «что читать дальше» в конце урока.
  const ordered = phases.flatMap((phase) => phase.lessons);

  ordered.forEach((lesson, position) => {
    const model = models.get(lesson.slug);
    if (!model) return;

    const after = ordered[position + 1];
    const nextLesson = after ? { slug: after.slug, title: after.title } : null;

    const bundle = exercises.get(lesson.slug);
    const exercise = bundle
      ? { slug: bundle.slug, functions: bundle.functions, urls: exerciseUrls(basePath, bundle) }
      : null;

    // Страница урока — оглавление; каждый шаг живёт своей страницей, чтобы
    // урок читался порциями, а не одним полотном.
    write(
      path.join("lesson", lesson.slug, "index.html"),
      renderLessonIndexPage(model, { basePath, nextLesson }),
    );
    model.blocks.forEach((block, index) => {
      write(
        path.join("lesson", lesson.slug, block.step.id, "index.html"),
        renderStepPage(model, index, { basePath, nextLesson, exercise }),
      );
    });
  });

  write("index.html", renderIndexPage(phases, { basePath }));
  write("assets/site.css", buildSiteCss());
  write("assets/harness.py", fs.readFileSync(path.join(root, "src", "site-python", "harness.py"), "utf8"));
  write(
    "assets/favicon.svg",
    fs.readFileSync(path.join(root, "src", "site-assets", "favicon.svg"), "utf8"),
  );
  // Без .nojekyll Pages прогоняет вывод через Jekyll и выбрасывает всё, что
  // начинается с подчёркивания.
  write(".nojekyll", "");
  copyKatexAssets();
  copyPyodide();
  await buildEditor();

  console.log(
    `Собрано: уроков ${catalog.length}, шагов ${renderedSteps}, ` +
      `не написано ${missingSteps}, схем ${copiedVisuals}, ` +
      `упражнений ${exercises.size}` +
      (skippedLessons > 0 ? `, пропущено уроков ${skippedLessons}` : ""),
  );
}

await main();
