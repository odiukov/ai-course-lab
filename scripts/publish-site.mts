// Публикация статического сайта в ветку gh-pages.
//
// Запуск: npm run site:publish
//
// Ни одной изменяющей git-команды в каталоге проекта: параллельно с этим уроки
// дописывает другой процесс, и любой stash/checkout отобрал бы у него файлы
// из-под рук. Поэтому публикация идёт из временного каталога, который ничего
// не знает о репозитории проекта.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HTTPS, а не SSH: ключ этой машины принадлежит другому аккаунту GitHub, у
// которого нет прав на запись в репозиторий. Учётные данные берутся у gh
// (`credential.helper` ниже) — тем же аккаунтом, под которым авторизован gh.
const REPO = process.env.SITE_REPO ?? "https://github.com/odiukov/ai-course-lab.git";
const BRANCH = "gh-pages";
const outDir = path.join(process.cwd(), "out");

const CREDENTIALS = ["-c", "credential.helper=!gh auth git-credential"];
// Сайт уезжает паком в десятки мегабайт, и на буфере по умолчанию (1 МБ)
// HTTPS-пуш обрывается на «RPC failed; HTTP 400».
const BUFFER = ["-c", "http.postBuffer=524288000"];

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/**
 * Пытается взять за основу то, что уже опубликовано.
 *
 * Без этого каждая публикация — новая история с нуля, и на провод уходит весь
 * сайт целиком: сотня мегабайт ради двух изменившихся страниц. С предком в
 * основе git отправляет только разницу. Первая публикация предка не находит и
 * честно уезжает целиком.
 */
function fetchPrevious(staging: string): boolean {
  try {
    run("git", [...CREDENTIALS, "fetch", "--depth=1", "-q", REPO, BRANCH], staging);
    run("git", ["reset", "--hard", "-q", "FETCH_HEAD"], staging);
    return true;
  } catch {
    return false;
  }
}

/** Убирает из каталога всё, кроме .git: содержимое приезжает из свежей сборки. */
function clearWorktree(staging: string): void {
  for (const entry of fs.readdirSync(staging)) {
    if (entry === ".git") continue;
    fs.rmSync(path.join(staging, entry), { recursive: true, force: true });
  }
}

function main(): void {
  if (!fs.existsSync(path.join(outDir, "index.html"))) {
    console.error("Нет out/index.html — сначала npm run site:build");
    process.exit(1);
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "course-site-"));
  try {
    run("git", ["init", "-q", "-b", BRANCH], staging);
    const incremental = fetchPrevious(staging);
    clearWorktree(staging);
    fs.cpSync(outDir, staging, { recursive: true });

    run("git", ["add", "-A"], staging);
    run(
      "git",
      [
        "-c",
        "user.name=course-site",
        "-c",
        "user.email=course-site@local",
        "commit",
        "-q",
        "-m",
        `site: ${new Date().toISOString()}`,
      ],
      staging,
    );
    // --force: ветка — артефакт сборки, а не журнал, и переписывать её можно
    // без сожалений. credential.helper задаётся флагом на одну команду, а не
    // записывается в конфиг: публикация не должна менять настройки машины.
    run(
      "git",
      [...CREDENTIALS, ...BUFFER, "push", "--force", "--quiet", REPO, `HEAD:${BRANCH}`],
      staging,
    );

    console.log(
      `Опубликовано в ${REPO} (${BRANCH})` +
        (incremental ? " — отправлена только разница." : " — первая публикация, целиком."),
    );
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

main();
