"use client";

import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
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
  /** Функция текущего шага: подсвечена, остальные свёрнуты. */
  focus?: { startLine: number; endLine: number };
  lspUrl: string | null;
  onChange: (code: string) => void;
  onLspError: (message: string) => void;
}

function fileUri(file: string): string {
  return `file://${file.split("/").map(encodeURIComponent).join("/")}`;
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

function applyFocus(
  editor: Monaco.editor.IStandaloneCodeEditor,
  decorations: Monaco.editor.IEditorDecorationsCollection,
  focus: { startLine: number; endLine: number },
): void {
  const model = editor.getModel();
  if (!model) return;

  // Свёртка и затемнение остаются идемпотентными — они всегда пересчитаны, —
  // но курсор двигаем только если он и так не внутри нужной функции. Без
  // этой проверки любой повторный вызов (а он приходит на каждое изменение
  // объекта focus, включая логически то же самое) выкидывал бы курсор в
  // строку 1 функции прямо во время набора текста.
  const position = editor.getPosition();
  const caretInside =
    position !== null && position.lineNumber >= focus.startLine && position.lineNumber <= focus.endLine;

  void editor
    .getAction("editor.foldAll")
    ?.run()
    .then(() => {
      if (!caretInside) editor.setPosition({ lineNumber: focus.startLine, column: 1 });
      return editor.getAction("editor.unfold")?.run();
    })
    .then(() => {
      if (!caretInside) editor.revealLineNearTop(focus.startLine);
    });

  const total = model.getLineCount();
  const outside: Monaco.editor.IModelDeltaDecoration[] = [];
  if (focus.startLine > 1) {
    outside.push({
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: focus.startLine - 1, endColumn: 1 },
      options: { isWholeLine: true, inlineClassName: "lab-dim-line" },
    });
  }
  if (focus.endLine < total) {
    outside.push({
      range: { startLineNumber: focus.endLine + 1, startColumn: 1, endLineNumber: total, endColumn: 1 },
      options: { isWholeLine: true, inlineClassName: "lab-dim-line" },
    });
  }
  decorations.set(outside);
}

export function CodeEditor({ file, code, focus, lspUrl, onChange, onLspError }: CodeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const clientRef = useRef<LspClient | null>(null);
  const docKeyRef = useRef<string | null>(null);
  const versionRef = useRef(1);
  const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const changeListenerRef = useRef<Monaco.IDisposable | null>(null);
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

      const uri = monaco.Uri.parse(fileUri(file));
      const model =
        monaco.editor.getModel(uri) ?? monaco.editor.createModel(code, "python", uri);
      if (model.getValue() !== code) model.setValue(code);
      docKeyRef.current = model.uri.toString();

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
      decorationsRef.current = editor.createDecorationsCollection();
      setEditorReady(true);

      // Модель переживает размонтирование (её держит кэш monaco.editor.getModel
      // по URI), поэтому слушатель нужно снять явно в cleanup — иначе повторный
      // монтаж того же файла копит слушателей, и каждый старый всё равно зовёт
      // onChange своего уже мёртвого экземпляра на каждое нажатие.
      changeListenerRef.current = model.onDidChangeContent(() => {
        const text = model.getValue();
        onChangeRef.current(text);
        clientRef.current?.didChange(fileUri(file), text, ++versionRef.current);
      });

      if (!lspUrl) return;

      const client = new LspClient({ url: lspUrl });
      clientRef.current = client;
      lspClients.set(docKeyRef.current, client);
      client.onDiagnostics((params) => {
        if (!monaco || params.uri !== fileUri(file)) return;
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
          rootUri: fileUri(root),
          folderName: root.slice(root.lastIndexOf("/") + 1),
        });
        client.didOpen(fileUri(file), model.getValue(), versionRef.current);
      } catch (error) {
        // Редактор остаётся рабочим без языкового сервера — так записано в
        // таблице ошибок спеки. Наверх уходит причина для плашки.
        onLspError((error as Error).message);
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
      decorationsRef.current?.clear();
      decorationsRef.current = null;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- редактор монтируется один раз на файл
  }, [file, lspUrl]);

  // Внешняя правка (IDE или кнопка «взять как есть») приезжает пропом: модель
  // обновляется, только если текст действительно другой, иначе каждый ререндер
  // сбрасывал бы курсор в начало файла.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (model && model.getValue() !== code) model.setValue(code);
  }, [code]);

  // Своя функция развёрнута и подсвечена, чужие свёрнуты и приглушены.
  // Зависимость от editorReady — не от одного focus — это то, что позволяет
  // применить свёртку и в момент, когда focus меняется на уже смонтированном
  // редакторе, и в момент, когда редактор только доехал, а focus был известен
  // с самого первого рендера.
  useEffect(() => {
    const editor = editorRef.current;
    const decorations = decorationsRef.current;
    if (!editor || !decorations || !focus) return;
    applyFocus(editor, decorations, focus);
  }, [focus, editorReady]);

  return (
    <div
      ref={host}
      className="h-[420px] w-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
    />
  );
}
