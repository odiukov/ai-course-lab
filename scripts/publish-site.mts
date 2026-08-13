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

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function main(): void {
  if (!fs.existsSync(path.join(outDir, "index.html"))) {
    console.error("Нет out/index.html — сначала npm run site:build");
    process.exit(1);
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "course-site-"));
  try {
    fs.cpSync(outDir, staging, { recursive: true });

    run("git", ["init", "-q", "-b", BRANCH], staging);
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
    // --force: ветка — артефакт сборки, а не журнал. История из одного коммита
    // каждый раз.
    //
    // credential.helper задаётся флагом на одну команду, а не записывается в
    // конфиг: публикация не должна менять настройки машины автора.
    run(
      "git",
      [
        "-c",
        "credential.helper=!gh auth git-credential",
        // Сайт уезжает одним паком в несколько мегабайт, и на буфере по
        // умолчанию (1 МБ) HTTPS-пуш обрывается на «RPC failed; HTTP 400».
        "-c",
        "http.postBuffer=524288000",
        "push",
        "--force",
        "--quiet",
        REPO,
        `HEAD:${BRANCH}`,
      ],
      staging,
    );

    console.log(`Опубликовано в ${REPO} (${BRANCH}).`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

main();
