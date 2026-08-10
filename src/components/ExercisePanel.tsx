"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BenchTable } from "@/components/BenchTable";
import { CodeEditor } from "@/components/CodeEditor";
import { errorStatus } from "@/lib/agent/error-message";
import { fetchJson } from "@/lib/api/fetch-json";
import { parseSseFrames } from "@/lib/api/sse-client";
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

interface ExerciseData {
  file: string;
  relPath: string;
  code: string;
  mtimeMs: number;
  functions: ExerciseFunction[];
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

export function ExercisePanel({
  slug,
  stepId,
  fn,
  lspUrl,
  onProgressChanged,
}: {
  slug: string;
  stepId: string;
  fn: string;
  lspUrl: string | null;
  onProgressChanged: () => void;
}) {
  const [data, setData] = useState<ExerciseData | null>(null);
  const [code, setCode] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [running, setRunning] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [bench, setBench] = useState<BenchReport | null>(null);
  const [review, setReview] = useState("");
  const [reviewDone, setReviewDone] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Текст, который точно лежит на диске, и mtime этого файла — то, с чем
  // сервер сверяет предусловие записи.
  const savedCodeRef = useRef("");
  const mtimeRef = useRef(0);
  // Всегда самый свежий текст редактора: отложенное сохранение может
  // завершиться уже после того, как ученик успел напечатать ещё, и не должно
  // подхватить устаревшее замыкание.
  const latestCodeRef = useRef(code);
  latestCodeRef.current = code;

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
  }, [stepId, fn]);

  const load = useCallback(async () => {
    const result = await fetchJson<ExerciseData>(`/api/lesson/${slug}/exercise`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Пока ответ летел, ученик мог начать печатать — тогда внешний файл
    // применять нельзя, иначе набранное исчезнет под ним.
    if (latestCodeRef.current !== savedCodeRef.current) return;

    const json = result.data;
    setData(json);
    setCode(json.code);
    savedCodeRef.current = json.code;
    latestCodeRef.current = json.code;
    mtimeRef.current = json.mtimeMs;
    setSaveState("saved");
    saveErrorRef.current = null;
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- первая загрузка файла упражнения
    void load();
  }, [load]);

  // Одна попытка записи. Отдаёт, что именно случилось: «ok» — текст на диске,
  // «conflict» — файл на диске изменился и был перечитан (черновик не затёр
  // чужую правку), «error» — записи не было.
  const putOnce = useCallback(
    async (text: string): Promise<"ok" | "conflict" | "error"> => {
      const result = await fetchJson<{ mtimeMs: number; functions: ExerciseFunction[] }>(
        `/api/lesson/${slug}/exercise`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          // mtime, который клиент видел последним: без него отложенный PUT
          // молча затирает вставку recall или правку из IDE.
          body: JSON.stringify({ code: text, mtimeMs: mtimeRef.current }),
        },
      );

      if (result.ok) {
        savedCodeRef.current = text;
        mtimeRef.current = result.data.mtimeMs;
        setData((current) => (current ? { ...current, functions: result.data.functions } : current));
        if (latestCodeRef.current === text) {
          setSaveState("saved");
          saveErrorRef.current = null;
        }
        return "ok";
      }

      const current = (result.data as { current?: ExerciseData } | null)?.current;
      if (result.status === 409 && current) {
        savedCodeRef.current = current.code;
        latestCodeRef.current = current.code;
        mtimeRef.current = current.mtimeMs;
        setCode(current.code);
        setData((existing) =>
          existing
            ? { ...existing, code: current.code, mtimeMs: current.mtimeMs, functions: current.functions }
            : existing,
        );
        setSaveState("saved");
        saveErrorRef.current = "Файл на диске изменился, редактор перечитал его.";
        setError(
          "Файл упражнения изменился на диске (правка из IDE или вставка прошлого кода) — редактор перечитал его. Проверь код и нажми ещё раз.",
        );
        return "conflict";
      }

      saveErrorRef.current = result.error;
      setSaveState("failed");
      setError(`Не удалось сохранить файл: ${result.error}`);
      return "error";
    },
    [slug],
  );

  // Догоняющая запись: пока предыдущий PUT ждал ответа, ученик мог напечатать
  // ещё, и цикл добивает остаток без нового ожидания дебаунса. Одна повторная
  // попытка на сетевую ошибку — раньше первая же неудача была окончательной:
  // savedCodeRef не двигался, и ничего больше не пыталось сохранить.
  const runSave = useCallback(async (): Promise<boolean> => {
    while (latestCodeRef.current !== savedCodeRef.current) {
      const text = latestCodeRef.current;
      let outcome = await putOnce(text);
      if (outcome === "error") outcome = await putOnce(text);
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
   * Именно это ждут «Прогнать тесты» и «Разбор»: без ожидания pytest читал
   * файл, которого учащийся уже не видит, и вердикт по нему сохранялся.
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

  // Автосохранение с задержкой в секунду: файл на диске — единственная правда,
  // и держать несохранённый черновик в браузере нельзя, иначе прогон тестов
  // проверит не тот код, который человек видит.
  useEffect(() => {
    if (!data || code === savedCodeRef.current) return;
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
  }, [code, data, flush]);

  // Уход с шага, remount после вставки recall и закрытая вкладка не должны
  // стоить учащемуся последней секунды набора: раньше размонтирование только
  // снимало таймер, и набранное пропадало, пока заголовок обещал «сохраняю…».
  useEffect(() => () => void flushRef.current(), []);

  useEffect(() => {
    const onPageHide = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (latestCodeRef.current === savedCodeRef.current) return;
      // Страница уходит: обычный fetch браузер отменит, keepalive — то, что
      // всё-таки доносит последнюю запись до сервера.
      void fetch(`/api/lesson/${slug}/exercise`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: latestCodeRef.current, mtimeMs: mtimeRef.current }),
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
  useEffect(() => {
    const timer = setInterval(async () => {
      if (latestCodeRef.current !== savedCodeRef.current) return;
      const meta = await fetchJson<{ mtimeMs: number | null }>(
        `/api/lesson/${slug}/exercise?meta=1`,
      );
      if (!meta.ok || !meta.data.mtimeMs || meta.data.mtimeMs <= mtimeRef.current) return;
      if (latestCodeRef.current !== savedCodeRef.current) return;
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
      const testedCode = savedCodeRef.current;

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

  // Мемоизируем по числам и имени, а не по объекту функции: сервер отдаёт
  // свежий (структурно тот же, но новый по ссылке) массив functions после
  // каждого успешного автосохранения. Имя функции здесь — то, по чему
  // CodeEditor понимает, что сменился шаг, а не просто сдвинулись строки.
  const focusFn = data?.functions.find((item) => item.fn === fn);
  const focus = useMemo(
    () =>
      focusFn
        ? { name: fn, startLine: focusFn.startLine, endLine: focusFn.endLine }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- нужны именно числа и имя, не ссылка на focusFn
    [fn, focusFn?.startLine, focusFn?.endLine],
  );

  if (!data) {
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
          <code>{data.relPath}</code> · функция <code>{fn}</code>
        </span>
        <span>
          {saveState === "saved" ? "сохранено" : saveState === "saving" ? "сохраняю…" : "не сохранено"}
        </span>
      </div>

      <CodeEditor
        file={data.file}
        code={code}
        focus={focus}
        lspUrl={lspUrl}
        onChange={setCode}
        onLspError={setError}
      />

      <div className="flex items-center gap-3">
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
