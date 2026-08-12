"use client";

import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import { hiddenRanges, type LineRange } from "@/lib/editor/hidden-areas";
import { LspClient } from "@/lib/lsp/client";
import {
  hoverMarkdown,
  toCompletionItems,
  toMarker,
  toSignatureHelp,
  type LspDiagnostic,
  type MonacoRange,
} from "@/lib/lsp/monaco-map";

export interface CodeEditorProps {
  /** Абсолютный путь файла: из него собирается file://-URI для pyright. */
  file: string;
  code: string;
  /**
   * Функция текущего шага: она одна и видна, остальной файл спрятан.
   *
   * `name` здесь обязателен и несёт всю смысловую нагрузку: строки съезжают от
   * любой правки в файле (и приезжают заново после каждого автосохранения), а
   * двигать курсор нужно только когда шаг действительно сменил функцию.
   */
  focus?: { name: string; startLine: number; endLine: number };
  lspUrl: string | null;
  onChange: (code: string) => void;
  /** Готовая фраза для плашки: что с языковым сервером и что при этом работает. */
  onLspError: (message: string) => void;
}

// Регистрация провайдеров — на язык, а не на редактор: Monaco держит их
// глобально, и второй монтаж компонента иначе даёт по два одинаковых
// автокомплита на каждое нажатие.
let providersRegistered = false;

// Провайдеры регистрируются один раз на весь язык и живут дольше любого
// конкретного редактора. Если бы они замыкали ref конкретного монтажа,
// после его размонтирования этот ref навсегда стал бы null, и все
// последующие редакторы получали бы пустые подсказки. Реестр по URI
// документа — это то, что провайдер спрашивает заново при каждом запросе,
// а не то, что он запомнил при регистрации.
const lspClients = new Map<string, LspClient>();

function clientForModel(model: Monaco.editor.ITextModel): LspClient | undefined {
  return lspClients.get(model.uri.toString());
}

// Рамка редактора живёт по содержимому: на экране одна функция, и фиксированная
// высота под самую длинную из них оставляла под короткой полэкрана пустоты.
// Нижняя граница — чтобы редактор не схлопнулся в две строки и в него было
// куда печатать; верхняя — чтобы длинная функция не выталкивала кнопку прогона
// тестов за экран, дальше редактор скроллит сам.
const MIN_EDITOR_HEIGHT = 200;
const MAX_EDITOR_HEIGHT = 520;

// setHiddenAreas не выведен в публичные типы monaco-editor, хотя это обычный
// метод виджета, на котором стоит вся свёртка редактора. Каст — здесь, один
// раз, чтобы ниже работать с нормально типизированной функцией.
type EditorWithHiddenAreas = Monaco.editor.IStandaloneCodeEditor & {
  setHiddenAreas(ranges: LineRange[]): void;
};

// Прячет из показа всё, кроме функции шага. Модель при этом целая: pyright
// по-прежнему видит импорты и соседние функции, а сохранение пишет весь файл.
//
// Пересчитывается на каждую правку — Monaco держит скрытые области обычными
// декорациями и сам отбрасывает вызов, если диапазоны не изменились.
function hideOutside(editor: Monaco.editor.IStandaloneCodeEditor, startLine: number | null): void {
  const model = editor.getModel();
  if (!model) return;
  (editor as EditorWithHiddenAreas).setHiddenAreas(
    startLine === null ? [] : hiddenRanges(model, startLine),
  );
}

export function CodeEditor({ file, code, focus, lspUrl, onChange, onLspError }: CodeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const clientRef = useRef<LspClient | null>(null);
  const docKeyRef = useRef<string | null>(null);
  const versionRef = useRef(1);
  const changeListenerRef = useRef<Monaco.IDisposable | null>(null);
  const sizeListenerRef = useRef<Monaco.IDisposable | null>(null);
  // Имя функции, на которую редактор уже наведён: пока оно не изменилось,
  // курсор трогать нельзя.
  const focusedNameRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Редактор монтируется асинхронно (динамический импорт monaco), поэтому в
  // момент первого рендера editorRef.current ещё null. Без этого флага
  // эффект свёртки, зависящий только от focus, никогда не перезапустится для
  // того случая, когда focus уже пришёл на первый рендер и больше не
  // меняется — а это самый частый случай: шаг открывается сразу с известной
  // функцией.
  const [editorReady, setEditorReady] = useState(false);

  // Один эффект на весь жизненный цикл редактора: Monaco нельзя пересоздавать
  // на каждый ререндер, а зависимость от code сделала бы ровно это.
  useEffect(() => {
    let disposed = false;
    let monaco: typeof Monaco | null = null;

    async function mount() {
      // Воркер редактора нужен до импорта monaco: иначе Monaco поднимет свой
      // и попробует взять его с CDN, чего в локальном приложении нет.
      (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
        getWorker: () =>
          new Worker(new URL("monaco-editor/editor/editor.worker.js", import.meta.url), {
            type: "module",
          }),
      };

      monaco = await import("monaco-editor");
      if (disposed || !host.current) return;

      // URI документа считается ОДИН раз и дальше используется везде —
      // в didOpen/didChange, в сверке диагностик и в реестре клиентов, откуда
      // его берут провайдеры (`model.uri.toString()`). Раньше он писался двумя
      // способами: собранный руками `file://` + encodeURIComponent и
      // нормализованный Monaco. Для пути с `! ' ( ) *` они расходились, и
      // автокомплит молча отдавал пустоту — провайдер не находил клиента.
      const uri = monaco.Uri.file(file);
      const model =
        monaco.editor.getModel(uri) ?? monaco.editor.createModel(code, "python", uri);
      if (model.getValue() !== code) model.setValue(code);
      const docUri = model.uri.toString();
      docKeyRef.current = docUri;

      const editor = monaco.editor.create(host.current, {
        model,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        tabSize: 4,
        insertSpaces: true,
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        folding: true,
        theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "vs-dark" : "vs",
      });
      editorRef.current = editor;

      // Высота хоста считается по видимому содержимому: скрытые области в
      // getContentHeight не входят, поэтому рамка садится ровно по функции
      // шага и переезжает сама, когда учащийся дописывает строки.
      const applyHeight = () => {
        if (!host.current) return;
        const height = Math.min(
          Math.max(editor.getContentHeight(), MIN_EDITOR_HEIGHT),
          MAX_EDITOR_HEIGHT,
        );
        host.current.style.height = `${height}px`;
      };
      applyHeight();
      sizeListenerRef.current = editor.onDidContentSizeChange(applyHeight);

      setEditorReady(true);

      // Модель переживает размонтирование (её держит кэш monaco.editor.getModel
      // по URI), поэтому слушатель нужно снять явно в cleanup — иначе повторный
      // монтаж того же файла копит слушателей, и каждый старый всё равно зовёт
      // onChange своего уже мёртвого экземпляра на каждое нажатие.
      changeListenerRef.current = model.onDidChangeContent(() => {
        const text = model.getValue();
        onChangeRef.current(text);
        clientRef.current?.didChange(docUri, text, ++versionRef.current);
      });

      if (!lspUrl) return;

      const client = new LspClient({ url: lspUrl });
      clientRef.current = client;
      lspClients.set(docUri, client);
      // Мост может умереть посреди урока (перезапуск npm run dev, упавший
      // pyright). Плашка здоровья спрашивает его один раз при монтировании,
      // поэтому сказать об этом может только сам клиент.
      client.onClose((reason) => {
        if (disposed) return;
        onLspError(`Pyright отключился: ${reason}. Редактор работает как обычный, без типов и автокомплита.`);
      });
      client.onDiagnostics((params) => {
        if (!monaco || params.uri !== docUri) return;
        monaco.editor.setModelMarkers(
          model,
          "pyright",
          (params.diagnostics as LspDiagnostic[]).map(toMarker),
        );
      });

      if (!providersRegistered) {
        providersRegistered = true;
        const wordRange = (
          textModel: Monaco.editor.ITextModel,
          position: Monaco.Position,
        ): MonacoRange => {
          const word = textModel.getWordUntilPosition(position);
          return {
            startLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: word.endColumn,
          };
        };

        monaco.languages.registerCompletionItemProvider("python", {
          triggerCharacters: [".", "(", ","],
          provideCompletionItems: async (textModel, position) => {
            const current = clientForModel(textModel);
            if (!current) return { suggestions: [] };
            const result = await current.request("textDocument/completion", {
              textDocument: { uri: textModel.uri.toString() },
              position: { line: position.lineNumber - 1, character: position.column - 1 },
            });
            return {
              suggestions: toCompletionItems(result, wordRange(textModel, position)).map((item) => ({
                ...item,
                kind: item.kind as Monaco.languages.CompletionItemKind,
                range: item.range as Monaco.IRange,
                // Строка import из авто-импорта pyright: без неё вставляется
                // голое имя, и следующий прогон падает не по вине учащегося.
                additionalTextEdits: item.additionalTextEdits?.map((edit) => ({
                  range: edit.range as Monaco.IRange,
                  text: edit.text,
                })),
              })),
            };
          },
        });

        monaco.languages.registerHoverProvider("python", {
          provideHover: async (textModel, position) => {
            const current = clientForModel(textModel);
            if (!current) return null;
            const result = await current.request("textDocument/hover", {
              textDocument: { uri: textModel.uri.toString() },
              position: { line: position.lineNumber - 1, character: position.column - 1 },
            });
            const value = hoverMarkdown(result);
            return value ? { contents: [{ value }] } : null;
          },
        });

        monaco.languages.registerSignatureHelpProvider("python", {
          signatureHelpTriggerCharacters: ["(", ","],
          provideSignatureHelp: async (textModel, position) => {
            const current = clientForModel(textModel);
            if (!current) return null;
            const result = await current.request("textDocument/signatureHelp", {
              textDocument: { uri: textModel.uri.toString() },
              position: { line: position.lineNumber - 1, character: position.column - 1 },
            });
            const help = toSignatureHelp(result);
            return help
              ? { value: help as unknown as Monaco.languages.SignatureHelp, dispose: () => {} }
              : null;
          },
        });
      }

      try {
        const root = file.slice(0, file.lastIndexOf("/"));
        await client.start({
          rootUri: monaco.Uri.file(root).toString(),
          folderName: root.slice(root.lastIndexOf("/") + 1),
        });
        client.didOpen(docUri, model.getValue(), versionRef.current);
      } catch (error) {
        // Редактор остаётся рабочим без языкового сервера — так записано в
        // таблице ошибок спеки. Наверх уходит готовая фраза для плашки.
        onLspError(
          `Pyright не поднялся: ${(error as Error).message}. Редактор работает как обычный, без типов и автокомплита.`,
        );
      }
    }

    void mount();

    return () => {
      disposed = true;
      setEditorReady(false);

      // Удаляем запись реестра только если она всё ещё наша: если для этого
      // же файла успел смонтироваться второй редактор, его клиент уже
      // перезаписал запись, и удалять её нельзя — иначе второй экземпляр
      // останется без подсказок.
      const key = docKeyRef.current;
      const activeClient = clientRef.current;
      if (key && activeClient && lspClients.get(key) === activeClient) {
        lspClients.delete(key);
      }

      activeClient?.dispose();
      clientRef.current = null;
      changeListenerRef.current?.dispose();
      changeListenerRef.current = null;
      sizeListenerRef.current?.dispose();
      sizeListenerRef.current = null;
      editorRef.current?.dispose();
      editorRef.current = null;
      // Новый редактор обязан спрятать файл заново, даже если функция шага та
      // же самая: скрытые области живут в конкретном экземпляре, а не в модели.
      focusedNameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- редактор монтируется один раз на файл
  }, [file, lspUrl]);

  // Внешняя правка (IDE или кнопка «взять как есть») приезжает пропом: модель
  // обновляется, только если текст действительно другой, иначе каждый ререндер
  // сбрасывал бы курсор в начало файла.
  //
  // Не setValue: он стирает стек отмены, и текст, который учащийся набрал до
  // приезда внешней правки, уже нельзя вернуть через Ctrl+Z. Та же полная
  // замена, но обычной правкой модели, отмену сохраняет — pushStackElement
  // перед ней делает её отдельным шагом отмены, а не продолжением набора.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!model || model.getValue() === code) return;
    model.pushStackElement();
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: code }], () => null);
    model.pushStackElement();
  }, [code]);

  // На экране одна функция — своя. Остального файла для учащегося просто нет.
  //
  // Скрытые области пересчитываются на каждую правку: конец функции считается
  // по тексту и едет от каждой набранной строки, а числа из пропа приезжают
  // только после автосохранения. Курсор двигается, только когда сменилась
  // ФУНКЦИЯ шага: границы приходят заново после каждого сохранения, и иначе
  // правка в transpose уводила бы курсор через секунду после набора, потому
  // что у matmul сдвинулись номера строк.
  //
  // Зависимость от editorReady — не от одного focus — это то, что позволяет
  // спрятать лишнее и в момент, когда focus меняется на уже смонтированном
  // редакторе, и в момент, когда редактор только доехал, а focus был известен
  // с самого первого рендера.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;

    // Шаг без известной функции показывает файл целиком: спрятать по неизвестно
    // чему хуже, чем не прятать.
    if (!focus) {
      hideOutside(editor, null);
      focusedNameRef.current = null;
      return;
    }

    hideOutside(editor, focus.startLine);
    if (focusedNameRef.current !== focus.name) {
      focusedNameRef.current = focus.name;
      editor.setPosition({ lineNumber: focus.startLine, column: 1 });
      editor.revealLineNearTop(focus.startLine);
    }

    const listener = model.onDidChangeContent(() => hideOutside(editor, focus.startLine));
    return () => listener.dispose();
  }, [focus, editorReady]);

  return (
    <div
      ref={host}
      // Высоту дальше ведёт applyHeight; здесь она нужна на те доли секунды,
      // пока monaco догружается динамическим импортом.
      style={{ height: MIN_EDITOR_HEIGHT }}
      className="w-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
    />
  );
}
