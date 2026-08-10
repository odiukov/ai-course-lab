"use client";

import { useEffect, useRef } from "react";
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

export function CodeEditor({ file, code, focus, lspUrl, onChange, onLspError }: CodeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const clientRef = useRef<LspClient | null>(null);
  const versionRef = useRef(1);
  const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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

      model.onDidChangeContent(() => {
        const text = model.getValue();
        onChangeRef.current(text);
        clientRef.current?.didChange(fileUri(file), text, ++versionRef.current);
      });

      if (!lspUrl) return;

      const client = new LspClient({ url: lspUrl });
      clientRef.current = client;
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
            const current = clientRef.current;
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
            const current = clientRef.current;
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
            const current = clientRef.current;
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
      clientRef.current?.dispose();
      clientRef.current = null;
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
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !focus) return;
    const model = editor.getModel();
    if (!model) return;

    void editor
      .getAction("editor.foldAll")
      ?.run()
      .then(() => {
        editor.setPosition({ lineNumber: focus.startLine, column: 1 });
        return editor.getAction("editor.unfold")?.run();
      })
      .then(() => {
        editor.revealLineNearTop(focus.startLine);
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
    decorationsRef.current?.set(outside);
  }, [focus]);

  return (
    <div
      ref={host}
      className="h-[420px] w-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
    />
  );
}
