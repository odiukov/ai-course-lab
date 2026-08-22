"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BenchTable } from "@/components/BenchTable";
import { CodeEditor } from "@/components/CodeEditor";
import { errorStatus } from "@/lib/agent/error-message";
import { fetchJson } from "@/lib/api/fetch-json";
import { parseSseFrames } from "@/lib/api/sse-client";
import { pickActiveFile, type FileFunctions } from "@/lib/editor/active-file";
import type { BenchReport } from "@/lib/practice/bench";
import { practiceErrorStatus, type PracticeErrorKind } from "@/lib/practice/errors";

const SAVE_DELAY_MS = 1000;
const WATCH_INTERVAL_MS = 2000;
// Виды ошибок практики (бенч/тесты/спавн), которые бенч-раунд разбора тоже
// может прислать через SSE — их нужно вести через practiceErrorStatus, а не
// через общий errorStatus чата/генерации.
const PRACTICE_ERROR_KINDS: PracticeErrorKind[] = ["spawn", "timeout", "python", "output"];

interface ExerciseFunction {
  fn: string;
  startLine: number;
  endLine: number;
  implemented: boolean;
}

// Один файл упражнения — таким его отдаёт сервер и таким его держит панель.
interface ExerciseFileState {
  name: string;
  file: string;
  relPath: string;
  code: string;
  mtimeMs: number;
  functions: ExerciseFunction[];
}

// `multi` решает, рисовать ли полоску табов вообще: у одно-файлового
// упражнения (382 существующих) её не должно быть в принципе, а не просто
// «полоска с одним табом».
interface ExerciseData {
  multi: boolean;
  files: ExerciseFileState[];
}

// Для pickActiveFile: она решает по владению функцией, а не только по именам
// файлов, — список функций каждого файла достаточно свести к именам.
function fileFunctionNames(files: ExerciseFileState[]): FileFunctions[] {
  return files.map((item) => ({ name: item.name, functions: item.functions.map((fn) => fn.fn) }));
}

interface TestFailure {
  name: string;
  decisive: string;
}

interface TestResult {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  filtered: boolean;
  warning: string | null;
  failures: TestFailure[];
}

// Вердикт всегда помнит текст, который на самом деле прогоняли: иначе после
// правки кода на экране остаётся зелёная плашка и кнопка разбора, а разбор
// уходит агенту с прежними числами и новым файлом.
interface Verdict {
  state: "passed" | "failed";
  result: TestResult;
  testedCode: string;
}

type SaveState = "saved" | "saving" | "failed";

// Расхождение: файл на диске изменился мимо редактора (правка из IDE, вставка
// прошлого кода на recall-шаге), и записывать поверх нельзя. Держим ОБА текста
// — и тот, что на диске, и черновик учащегося на момент расхождения, — потому
// что решать, чей код остаётся, должен он, а не панель. `file` — какого файла
// это расхождение: конфликт всегда про АКТИВНЫЙ на момент записи файл, но имя
// нужно, чтобы не спутать его с файлом, на который могли успеть переключиться.
interface Conflict {
  file: string;
  disk: { code: string; mtimeMs: number; functions: ExerciseFunction[] };
  draft: string;
}

export function ExercisePanel({
  slug,
  stepId,
  fn,
  file,
  lspUrl,
  reloadToken = 0,
  onProgressChanged,
}: {
  slug: string;
  stepId: string;
  fn: string;
  /**
   * Файл упражнения, в котором живёт `fn` (`step.exercise_file`). Не назван —
   * у функции один-единственный файл, угадывать нечего.
   */
  file?: string;
  lspUrl: string | null;
  /**
   * Растёт, когда файл упражнения изменили мимо редактора (кнопка «Взять как
   * есть» на recall-шаге). Панель на это досохраняет набранное и перечитывает
   * файл — но не размонтируется: размонтирование съедало и черновик, и
   * сообщение о расхождении.
   */
  reloadToken?: number;
  onProgressChanged: () => void;
}) {
  const [data, setData] = useState<ExerciseData | null>(null);
  // Активный файл — своё состояние, а не то, что пересчитывается на каждый
  // рендер: клик по табу должен пережить любое обновление data после
  // автосохранения, а смена файла шага — это отдельное решение, принятое один
  // раз при переходе на шаг, а не на каждую перерисовку.
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [running, setRunning] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [bench, setBench] = useState<BenchReport | null>(null);
  const [review, setReview] = useState("");
  const [reviewDone, setReviewDone] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  // Имя функции, для которой кнопка сброса уже взведена, — не булев флаг.
  // Панель переживает переход между code-шагами, и взведённая на transpose
  // кнопка иначе оставалась бы взведённой над matmul.
  const [resetArmedFor, setResetArmedFor] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  // Пока прежний активный файл дожимается на диск перед переключением на
  // другой (клик по табу или смена файла шага), полоска табов блокируется:
  // иначе второй клик застал бы панель посреди записи первого файла.
  const [switchingTab, setSwitchingTab] = useState(false);

  // Текст, который точно лежит на диске, и mtime — по каждому файлу
  // упражнения отдельно: черновик соседнего файла не должен теряться или
  // путаться с чужим mtime при переключении таба.
  const savedCodeRef = useRef(new Map<string, string>());
  const mtimeRef = useRef(new Map<string, number>());
  // Всегда самый свежий текст редактора активного файла: отложенное
  // сохранение может завершиться уже после того, как ученик успел напечатать
  // ещё, и не должно подхватить устаревшее замыкание.
  const latestCodeRef = useRef(code);
  latestCodeRef.current = code;
  // Тот же приём для активного файла: колбэки читают его здесь, а не из
  // замыкания на момент своего создания — иначе переключение таба во время
  // отложенной записи не заметили бы.
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  // И для файла шага: он нужен внутри load(), которая не зависит от `file` в
  // своих deps (иначе она пересоздавалась бы на каждый переход между шагами и
  // перечитывала бы упражнение с сервера заново).
  const fileRef = useRef(file);
  fileRef.current = file;
  // Свежий data — для эффекта смены шага, который обязан читать список файлов
  // без того, чтобы зависеть от data: иначе он перезапускался бы на каждое
  // автосохранение (data меняется при каждом успешном PUT), а должен — только
  // на смену шага.
  const dataRef = useRef(data);
  dataRef.current = data;

  // Таймер дебаунса и запись «в полёте» живут в ref'ах, потому что их нужно
  // достать не только из эффекта: flush() обязан добить их обоих до того, как
  // pytest прочитает файл.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  // Причина последней неудачной записи — чтобы «тесты не запускались» не
  // затирало объяснение, почему файл не сохранился.
  const saveErrorRef = useRef<string | null>(null);

  // Всегда шаг/функция, которые сейчас показаны — не то, для чего был начат
  // конкретный запрос. runTests/runReview сверяются с этим перед тем, как
  // применить свой результат: если учащийся уже ушёл на другой шаг, ответ
  // запроса, начатого для прежней функции, отбрасывается целиком.
  const currentStepRef = useRef({ stepId, fn });
  currentStepRef.current = { stepId, fn };

  // Переключает показанный файл: и активное имя, и черновик под ним берутся
  // из map'ов по файлам — они уже заполнены к моменту вызова (первой их
  // заполняет load(), а до неё эта функция не зовётся). Общая точка для
  // первой загрузки, смены шага и клика по табу — везде одна и та же логика
  // «показать то, что мы про этот файл знаем».
  const activateFile = useCallback((name: string) => {
    activeFileRef.current = name;
    setActiveFile(name);
    const text = savedCodeRef.current.get(name) ?? "";
    latestCodeRef.current = text;
    setCode(text);
    setSaveState("saved");
    saveErrorRef.current = null;
    setConflict(null);
    setError(null);
  }, []);

  // Шесть code-шагов урока делят один и тот же файл упражнения, поэтому
  // сам файл (`data`/`code`) переживает переход между шагами и не
  // перезапрашивается — но вердикт, замер и разбор относились к прежней
  // функции и не должны просвечивать на новом шаге, пока тесты не прогнаны
  // заново. running/reviewing тоже сбрасываются здесь: иначе кнопка нового
  // шага осталась бы заблокированной, пока не придёт (и будет отброшен)
  // ответ, начатый ещё для прежней функции.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- сброс производного состояния прежнего шага
    setVerdict(null);
    setBench(null);
    setReview("");
    setReviewDone(false);
    setError(null);
    setRunning(false);
    setReviewing(false);

    // У многофайлового упражнения смена шага может назвать другой файл — тот
    // же список файлов, другая пара «файл + функция». Список уже загружен
    // (или ещё нет — тогда load() сам выберет активный файл, когда он придёт).
    const current = dataRef.current;
    if (!current) return;
    const resolved = pickActiveFile(fileFunctionNames(current.files), file, fn, activeFileRef.current);
    if (resolved === activeFileRef.current) return;
    // Прежний активный файл мог хранить недожатую правку — тот же порядок,
    // что и у ручного переключения таба: сначала дожимаем её на диск, потом
    // показываем новый файл.
    void flushRef.current().then((ok) => {
      if (ok) activateFile(resolved);
    });
  }, [stepId, fn, file, activateFile]);

  const load = useCallback(async () => {
    const result = await fetchJson<{ multi: boolean; files: ExerciseFileState[] }>(
      `/api/lesson/${slug}/exercise`,
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }

    const json = result.data;
    const resolved = pickActiveFile(
      fileFunctionNames(json.files),
      fileRef.current,
      currentStepRef.current.fn,
      activeFileRef.current,
    );

    // Пока ответ летел, ученик мог начать печатать в файле, который окажется
    // активным после этой загрузки, — тогда подменять его сервером нельзя.
    // На самой первой загрузке активного файла ещё нет, и это условие не
    // мешает.
    if (
      activeFileRef.current &&
      resolved === activeFileRef.current &&
      latestCodeRef.current !== savedCodeRef.current.get(activeFileRef.current)
    ) {
      return;
    }

    const nextSaved = new Map<string, string>();
    const nextMtime = new Map<string, number>();
    for (const item of json.files) {
      nextSaved.set(item.name, item.code);
      nextMtime.set(item.name, item.mtimeMs);
    }
    savedCodeRef.current = nextSaved;
    mtimeRef.current = nextMtime;

    setData({ multi: json.multi, files: json.files });
    activateFile(resolved);
  }, [slug, activateFile]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- первая загрузка файлов упражнения
    void load();
  }, [load]);

  // Одна попытка записи. Отдаёт, что именно случилось: «ok» — текст на диске,
  // «conflict» — файл на диске изменился и был перечитан (черновик не затёр
  // чужую правку), «error» — записи не было. `name` — какой файл упражнения
  // пишем: активный файл выбирает вызывающий (runSave), а не putOnce сам.
  const putOnce = useCallback(
    async (name: string, text: string): Promise<"ok" | "conflict" | "error"> => {
      const result = await fetchJson<{ name: string; mtimeMs: number; functions: ExerciseFunction[] }>(
        `/api/lesson/${slug}/exercise`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          // mtime, который клиент видел последним для ЭТОГО файла: без него
          // отложенный PUT молча затирает вставку recall или правку из IDE.
          body: JSON.stringify({
            file: name,
            code: text,
            mtimeMs: mtimeRef.current.get(name) ?? 0,
          }),
        },
      );

      if (result.ok) {
        savedCodeRef.current.set(name, text);
        mtimeRef.current.set(name, result.data.mtimeMs);
        setData((current) =>
          current
            ? {
                ...current,
                files: current.files.map((item) =>
                  item.name === name ? { ...item, functions: result.data.functions } : item,
                ),
              }
            : current,
        );
        setConflict((current) => (current?.file === name ? null : current));
        if (activeFileRef.current === name && latestCodeRef.current === text) {
          setSaveState("saved");
          saveErrorRef.current = null;
        }
        return "ok";
      }

      const onDisk = (
        result.data as { current?: { code: string; mtimeMs: number; functions: ExerciseFunction[] } } | null
      )?.current;
      if (result.status === 409 && onDisk) {
        // Текст учащегося НЕ подменяется содержимым файла. Раньше здесь стоял
        // setCode(current.code): он доезжал до model.setValue, а тот стирает
        // стек отмены — набранное исчезало без следа, и Ctrl+Z его не возвращал.
        // Теперь черновик остаётся в редакторе, а расхождение показывается
        // плашкой с двумя выходами: записать своё поверх или взять версию с
        // диска (её вставка идёт правкой, так что отмена работает).
        //
        // mtimeRef намеренно остаётся прежним: пока учащийся не решил, чей код
        // остаётся, ни одно автосохранение не имеет права записать файл.
        setConflict({ file: name, disk: onDisk, draft: text });
        if (activeFileRef.current === name) {
          setSaveState("failed");
          saveErrorRef.current = "Файл на диске изменился — реши, чей код оставить.";
        }
        return "conflict";
      }

      saveErrorRef.current = result.error;
      if (activeFileRef.current === name) {
        setSaveState("failed");
        setError(`Не удалось сохранить файл: ${result.error}`);
      }
      return "error";
    },
    [slug],
  );

  // Догоняющая запись: пока предыдущий PUT ждал ответа, ученик мог напечатать
  // ещё, и цикл добивает остаток без нового ожидания дебаунса. Одна повторная
  // попытка на сетевую ошибку — раньше первая же неудача была окончательной:
  // savedCodeRef не двигался, и ничего больше не пыталось сохранить.
  //
  // Файл берётся из activeFileRef В МОМЕНТ вызова, а не передаётся снаружи:
  // отложенный автосейв всегда пишет тот файл, что был активен, когда он
  // планировался, — а переключиться на другой файл можно только через flush(),
  // который сначала дожимает текущий целиком. Поэтому к моменту, когда
  // runSave фактически выполняется, activeFileRef ещё не успел смениться.
  const runSave = useCallback(async (): Promise<boolean> => {
    const name = activeFileRef.current;
    if (!name) return true;
    while (latestCodeRef.current !== savedCodeRef.current.get(name)) {
      const text = latestCodeRef.current;
      let outcome = await putOnce(name, text);
      if (outcome === "error") outcome = await putOnce(name, text);
      if (outcome !== "ok") return false;
    }
    return true;
  }, [putOnce]);

  /**
   * Досохраняет всё, что ждёт: снимает таймер дебаунса, дожидается записи,
   * которая уже в полёте, и добивает остаток. Обещание разрешается, только
   * когда файл на диске совпадает с редактором (или запись не удалась —
   * тогда false).
   *
   * Именно это ждут «Прогнать тесты» и «Разбор», а теперь и переключение
   * таба: без ожидания pytest читал файл, которого учащийся уже не видит, а
   * переключение таба потеряло бы связь с недожатой правкой.
   */
  const flush = useCallback((): Promise<boolean> => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Цепочкой, а не «вернуть текущую»: запись в полёте могла уже проверить
    // условие цикла и вот-вот выйти, не увидев последнего символа.
    const chained = (inFlightRef.current ?? Promise.resolve(true)).then(
      (okBefore) => runSave().then((ok) => okBefore && ok),
      () => runSave(),
    );
    inFlightRef.current = chained;
    void chained.finally(() => {
      if (inFlightRef.current === chained) inFlightRef.current = null;
    });
    return chained;
  }, [runSave]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Клик по табу: прежний активный файл дожимается на диск ПЕРЕД тем, как
  // показать другой, — иначе отложенный автосейв прежнего файла остался бы
  // без файла, за которым он был запланирован (activeFileRef уже указывал бы
  // на новый). Если запись не удалась (сеть, конфликт) — остаёмся на прежнем
  // файле: плашка про это уже висит над ним, уходить с неё нельзя.
  const switchTab = useCallback(
    async (name: string) => {
      if (name === activeFileRef.current || switchingTab) return;
      setSwitchingTab(true);
      try {
        const ok = await flush();
        if (ok) activateFile(name);
      } finally {
        setSwitchingTab(false);
      }
    },
    [switchingTab, flush, activateFile],
  );

  // Учащийся выбрал свой код: предусловие сдвигается на то, что сейчас на
  // диске, и обычная запись дописывает черновик поверх.
  const overwriteWithDraft = useCallback(() => {
    if (!conflict) return;
    mtimeRef.current.set(conflict.file, conflict.disk.mtimeMs);
    setSaveState("saving");
    void flush();
  }, [conflict, flush]);

  // Учащийся выбрал версию с диска. Она приезжает в редактор пропом `code`, а
  // CodeEditor применяет её правкой модели — поэтому черновик возвращается
  // через Ctrl+Z. Плашка остаётся на экране: из неё текст черновика можно ещё
  // и скопировать.
  const takeDiskVersion = useCallback(() => {
    if (!conflict) return;
    const { file: name, disk } = conflict;
    savedCodeRef.current.set(name, disk.code);
    mtimeRef.current.set(name, disk.mtimeMs);
    setData((existing) =>
      existing
        ? {
            ...existing,
            files: existing.files.map((item) =>
              item.name === name
                ? { ...item, code: disk.code, mtimeMs: disk.mtimeMs, functions: disk.functions }
                : item,
            ),
          }
        : existing,
    );
    if (activeFileRef.current === name) {
      latestCodeRef.current = disk.code;
      setCode(disk.code);
      setSaveState("saved");
    }
    setConflict(null);
    saveErrorRef.current = null;
    setError(null);
  }, [conflict]);

  /**
   * Возвращает функцию шага к заготовке из `exercise.template.py`.
   *
   * Выход из тупика, а не удобство: снесённую строку `def` сервер перестаёт
   * видеть, шаг остаётся без границ, редактор показывает весь файл — и
   * восстановить заготовку руками уже неоткуда, её вида на экране нет.
   *
   * Черновик здесь именно то, от чего учащийся отказывается, поэтому таймер
   * дебаунса снимается, а запись «в полёте» дожидается до запроса: иначе
   * поздний PUT прилетел бы уже после сброса и вернул стёртое обратно.
   *
   * `file` шлётся явно (файл шага, а не текущая вкладка): так же, как тесты и
   * recall резолвят адрес функции через resolveExerciseFile, чтобы сброс
   * попал в тот файл, где `fn` на самом деле лежит, даже если открыта вкладка
   * соседнего файла — просто посмотреть.
   */
  const resetToTemplate = useCallback(async () => {
    setResetting(true);
    setError(null);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      await (inFlightRef.current ?? Promise.resolve(true)).catch(() => false);

      const result = await fetchJson<{
        name: string;
        code: string;
        mtimeMs: number;
        functions: ExerciseFunction[];
      }>(`/api/lesson/${slug}/exercise/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fn, file }),
      });
      if (!result.ok) {
        setError(`Не удалось сбросить функцию: ${result.error}`);
        return;
      }

      const { name, code: resetCode, mtimeMs, functions } = result.data;
      savedCodeRef.current.set(name, resetCode);
      mtimeRef.current.set(name, mtimeMs);
      setData((existing) =>
        existing
          ? {
              ...existing,
              files: existing.files.map((item) =>
                item.name === name ? { ...item, code: resetCode, mtimeMs, functions } : item,
              ),
            }
          : existing,
      );
      if (activeFileRef.current === name) {
        latestCodeRef.current = resetCode;
        setCode(resetCode);
        setSaveState("saved");
      }
      // Расхождение (если оно было про этот же файл) разрешено самим сбросом:
      // на диске теперь то же, что в редакторе, и выбирать между текстами
      // больше нечего.
      setConflict((current) => (current?.file === name ? null : current));
      saveErrorRef.current = null;
    } finally {
      setResetting(false);
      setResetArmedFor(null);
    }
  }, [fn, file, slug]);

  // Автосохранение с задержкой в секунду: файл на диске — единственная правда,
  // и держать несохранённый черновик в браузере нельзя, иначе прогон тестов
  // проверит не тот код, который человек видит.
  useEffect(() => {
    if (!data || !activeFile || code === savedCodeRef.current.get(activeFile)) return;
    setSaveState("saving");
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, SAVE_DELAY_MS);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [code, data, activeFile, flush]);

  // Уход с шага и закрытая вкладка не должны стоить учащемуся последней
  // секунды набора: раньше размонтирование только снимало таймер, и набранное
  // пропадало, пока заголовок обещал «сохраняю…».
  useEffect(() => () => void flushRef.current(), []);

  // Вставка прошлого кода на recall-шаге меняет файл мимо редактора. Раньше
  // reader перемонтировал панель целиком, и черновик исчезал молча: flush из
  // размонтирования получал 409, а setError попадал уже в мёртвый компонент.
  // Теперь панель живая — сначала досохраняем набранное, потом перечитываем
  // файл, и если запись упёрлась в расхождение, учащийся видит плашку.
  const mountedTokenRef = useRef(reloadToken);
  useEffect(() => {
    if (reloadToken === mountedTokenRef.current) return;
    mountedTokenRef.current = reloadToken;
    void flushRef.current().then(() => load());
  }, [reloadToken, load]);

  useEffect(() => {
    const onPageHide = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const name = activeFileRef.current;
      if (!name || latestCodeRef.current === savedCodeRef.current.get(name)) return;
      // Страница уходит: обычный fetch браузер отменит, keepalive — то, что
      // всё-таки доносит последнюю запись до сервера.
      void fetch(`/api/lesson/${slug}/exercise`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file: name,
          code: latestCodeRef.current,
          mtimeMs: mtimeRef.current.get(name) ?? 0,
        }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [slug]);

  // Правка из IDE подтягивается сама. Свежесть читается из ref'а прямо в тике
  // (а не из значения, замкнутого при создании интервала), и проверяется ещё
  // раз перед применением: между ?meta=1 и load() проходят два круга к
  // серверу, и набранное за это время не должно быть перезаписано. `code` в
  // зависимостях не нужен — с ним интервал пересоздавался на каждое нажатие.
  // Опрашивается только активный файл — у остальных пока нет открытого
  // редактора, за состоянием которого нужно следить.
  useEffect(() => {
    const timer = setInterval(async () => {
      const name = activeFileRef.current;
      if (!name) return;
      if (latestCodeRef.current !== savedCodeRef.current.get(name)) return;
      const meta = await fetchJson<{ mtimeMs: number | null }>(
        `/api/lesson/${slug}/exercise?meta=1&file=${encodeURIComponent(name)}`,
      );
      if (!meta.ok || !meta.data.mtimeMs || meta.data.mtimeMs <= (mtimeRef.current.get(name) ?? 0)) {
        return;
      }
      // Учащийся мог успеть переключить таб, пока ответ летел — тогда правка
      // относится уже не к тому файлу, что сейчас на экране.
      if (activeFileRef.current !== name) return;
      if (latestCodeRef.current !== savedCodeRef.current.get(name)) return;
      await load();
    }, WATCH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load, slug]);

  const runTests = useCallback(async () => {
    const startedFor = { stepId, fn };
    const isCurrent = () =>
      currentStepRef.current.stepId === startedFor.stepId && currentStepRef.current.fn === startedFor.fn;

    setRunning(true);
    setError(null);
    setBench(null);
    setReview("");
    try {
      // Первым делом: файл на диске обязан совпасть с редактором, иначе pytest
      // прочитает прежнюю версию, а вердикт по ней запишется в базу.
      const flushed = await flush();
      if (!isCurrent()) return;
      if (!flushed) {
        setError(
          `Тесты не запускались: файл не сохранён, они проверили бы не тот код. ${saveErrorRef.current ?? ""}`.trim(),
        );
        return;
      }
      const testedCode = activeFileRef.current
        ? savedCodeRef.current.get(activeFileRef.current) ?? ""
        : "";

      const result = await fetchJson<{ result: TestResult; state: "passed" | "failed" }>(
        `/api/lesson/${slug}/tests`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stepId }),
        },
      );
      if (!isCurrent()) return;

      if (!result.ok) {
        const kind = (result.data as { kind?: PracticeErrorKind } | null)?.kind;
        setError(practiceErrorStatus(kind, result.error));
        return;
      }
      // Зелёный считает сервер (isPassingRun), а не панель: у клиента было своё
      // правило (`failed === 0 && total > 0`), и полностью пропущенный прогон
      // рисовал зелёную плашку с кнопкой разбора, которую сервер потом
      // отклонял с 409.
      setVerdict({ state: result.data.state, result: result.data.result, testedCode });
      onProgressChanged();
    } finally {
      if (isCurrent()) setRunning(false);
    }
  }, [flush, onProgressChanged, slug, stepId, fn]);

  const runReview = useCallback(async () => {
    const startedFor = { stepId, fn };
    const isCurrent = () =>
      currentStepRef.current.stepId === startedFor.stepId && currentStepRef.current.fn === startedFor.fn;

    setReviewing(true);
    setError(null);
    setReview("");
    setReviewDone(false);

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const flushed = await flush();
      if (!isCurrent()) return;
      if (!flushed) {
        setError(
          `Разбор не запускался: файл не сохранён, агент увидел бы не тот код. ${saveErrorRef.current ?? ""}`.trim(),
        );
        return;
      }

      let response: Response;
      try {
        response = await fetch(`/api/lesson/${slug}/review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stepId }),
        });
      } catch (fetchError) {
        if (isCurrent()) setError(`Сервер не ответил: ${(fetchError as Error).message}`);
        return;
      }

      // Учащийся мог уже уйти на другой шаг, пока заголовки ответа летели —
      // тогда весь этот поток относится к прежней функции и не должен трогать
      // состояние нового шага. Поток при этом надо закрыть: незакрытый читатель
      // держит единственный слот агента и дописывает разбор в чужой шаг.
      if (!isCurrent()) {
        void response.body?.cancel();
        return;
      }

      if (!response.ok || !response.body) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (isCurrent()) setError(json.error ?? "Разбор недоступен");
        return;
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let collected = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // Та же проверка на каждый принятый кусок потока: поздний токен из
        // разбора прежней функции не должен просочиться в панель новой.
        if (!isCurrent()) return;
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = parseSseFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          if (frame.event === "bench") setBench(frame.data as BenchReport);
          if (frame.event === "token") {
            collected += (frame.data as { text: string }).text;
            setReview(collected);
          }
          // Сервер пишет разбор в чат шага (`addChatMessage`) только после этого
          // кадра — до него текст на экране существует лишь в браузере, и
          // перезагрузка страницы его потеряет.
          if (frame.event === "done") setReviewDone(true);
          if (frame.event === "error") {
            const payload = frame.data as { kind?: string; message?: string };
            setError(
              PRACTICE_ERROR_KINDS.includes(payload.kind as PracticeErrorKind)
                ? practiceErrorStatus(payload.kind as PracticeErrorKind, payload.message ?? "")
                : errorStatus(payload.kind, payload.message ?? ""),
            );
          }
        }
      }

      if (!isCurrent()) return;
      onProgressChanged();
    } catch (streamError) {
      if (isCurrent()) setError(`Разбор оборвался: ${(streamError as Error).message}`);
    } finally {
      // Читатель отменяется на любом выходе, кроме дочитанного до конца
      // потока: cancel() уже закрытого — это no-op, а брошенный держал бы
      // слот агента.
      void reader?.cancel().catch(() => {});
      if (isCurrent()) setReviewing(false);
    }
  }, [flush, onProgressChanged, slug, stepId, fn]);

  const activeFileState = data?.files.find((item) => item.name === activeFile);

  // Мемоизируем по числам и имени, а не по объекту функции: сервер отдаёт
  // свежий (структурно тот же, но новый по ссылке) массив functions после
  // каждого успешного автосохранения. Имя функции здесь — то, по чему
  // CodeEditor понимает, что сменился шаг, а не просто сдвинулись строки.
  //
  // Если активная вкладка — не тот файл, где живёт fn (учащийся открыл
  // соседний файл просто посмотреть), focusFn не находится, и редактор
  // показывает файл целиком — это ожидаемо: прятать нечего, своей функции
  // здесь нет.
  const focusFn = activeFileState?.functions.find((item) => item.fn === fn);
  const focus = useMemo(
    () =>
      focusFn
        ? { name: fn, startLine: focusFn.startLine, endLine: focusFn.endLine }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- нужны именно числа и имя, не ссылка на focusFn
    [fn, focusFn?.startLine, focusFn?.endLine],
  );

  if (!data || !activeFile || !activeFileState) {
    return <p className="text-sm text-slate-400">{error ?? "Открываю упражнение…"}</p>;
  }

  const green = verdict?.state === "passed";
  // Вердикт относится к тексту, который прогоняли. Как только редактор от него
  // ушёл, зелёная плашка и разбор больше не про этот код.
  const staleVerdict = verdict !== null && verdict.testedCode !== code;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between text-xs text-slate-400">
        <span>
          <code>{activeFileState.relPath}</code> · функция <code>{fn}</code>
        </span>
        <span>
          {saveState === "saved" ? "сохранено" : saveState === "saving" ? "сохраняю…" : "не сохранено"}
        </span>
      </div>

      {/* Полоска табов — только у многофайлового упражнения. У одно-файлового
          (данные истории) её нет вовсе, а не полоска с единственным табом. */}
      {data.multi && (
        <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700">
          {data.files.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => void switchTab(item.name)}
              disabled={switchingTab}
              className={`rounded-t px-3 py-1.5 text-xs disabled:opacity-50 ${
                item.name === activeFile
                  ? "border border-b-0 border-slate-300 bg-white font-medium text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}

      <CodeEditor
        file={activeFileState.file}
        code={code}
        focus={focus}
        lspUrl={lspUrl}
        onChange={setCode}
        onLspError={setError}
      />

      {conflict && conflict.file === activeFile && (
        <div
          role="alert"
          className="space-y-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          <p className="font-medium">Файл упражнения изменился на диске.</p>
          <p>
            Так бывает, когда правку внёс редактор в IDE или когда ты нажал «Взять как есть» на
            шаге-напоминании. Твой текст остался в редакторе и никуда не пропал, но на диск он
            пока не записан — реши, чей код остаётся.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={overwriteWithDraft}
              className="rounded bg-amber-700 px-3 py-1 text-xs text-white"
            >
              Записать мой код поверх
            </button>
            <button
              onClick={takeDiskVersion}
              className="rounded border border-amber-700 px-3 py-1 text-xs"
            >
              Взять версию с диска
            </button>
            <button onClick={() => setConflict(null)} className="px-2 py-1 text-xs underline">
              скрыть
            </button>
          </div>
          <details>
            <summary className="cursor-pointer text-xs">Версия с диска</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-white/60 p-2 text-xs dark:bg-black/30">
              <code>{conflict.disk.code}</code>
            </pre>
          </details>
          <details>
            <summary className="cursor-pointer text-xs">Мой текст на момент расхождения</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-white/60 p-2 text-xs dark:bg-black/30">
              <code>{conflict.draft}</code>
            </pre>
          </details>
          <p className="text-xs">
            Возьмёшь версию с диска — свой текст вернёшь через Ctrl+Z или скопируешь отсюда.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void runTests()}
          disabled={running}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        >
          {running ? "Гоняю тесты…" : `Прогнать тесты ${fn}`}
        </button>
        {green && !staleVerdict && (
          <button
            onClick={() => void runReview()}
            disabled={reviewing}
            className="rounded border border-emerald-600 px-4 py-2 text-sm text-emerald-700 disabled:opacity-40 dark:text-emerald-400"
          >
            {reviewing ? "Разбираю…" : "Замер и разбор кода"}
          </button>
        )}
        {/* Сброс стирает написанное, поэтому одного нажатия мало: первое
            превращает кнопку в вопрос, и только второе идёт на сервер. */}
        {resetArmedFor === fn ? (
          <>
            <button
              onClick={() => void resetToTemplate()}
              disabled={resetting}
              className="rounded bg-rose-700 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {resetting ? "Сбрасываю…" : `Точно стереть мой ${fn}?`}
            </button>
            <button
              onClick={() => setResetArmedFor(null)}
              className="px-2 py-2 text-sm underline"
            >
              отмена
            </button>
          </>
        ) : (
          <button
            onClick={() => setResetArmedFor(fn)}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            Сбросить функцию
          </button>
        )}
      </div>

      {verdict && (
        <div
          className={`rounded px-3 py-2 text-sm ${
            staleVerdict
              ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              : green
                ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                : "bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-200"
          }`}
        >
          {staleVerdict && <p className="mb-1 font-medium">Код изменился после прогона.</p>}
          <p>
            {verdict.result.passed} из {verdict.result.total} зелёные
            {verdict.result.filtered ? "" : " (прогнан весь файл)"}
          </p>
          {verdict.result.warning && <p className="mt-1 text-xs">{verdict.result.warning}</p>}
          {verdict.result.failures.length > 0 && (
            <p className="mt-1">
              Первый упавший: <code>{verdict.result.failures[0].name}</code>
              <br />
              <code className="text-xs">{verdict.result.failures[0].decisive}</code>
            </p>
          )}
          {staleVerdict && (
            <p className="mt-1 text-xs">Прогони тесты заново, чтобы вердикт снова что-то значил.</p>
          )}
        </div>
      )}

      {bench && <BenchTable report={bench} fn={fn} />}
      {review && (
        <div className="rounded bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900">
          <p className="mb-1 text-xs uppercase text-slate-400">разбор</p>
          <p className="whitespace-pre-wrap">{review}</p>
          <p className="mt-2 text-xs text-slate-400">
            {reviewDone
              ? "Разбор сохранён в чате этого шага — он останется в истории урока."
              : "Разбор ещё пишется — не перезагружай страницу, иначе он не сохранится."}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </p>
      )}
    </section>
  );
}
