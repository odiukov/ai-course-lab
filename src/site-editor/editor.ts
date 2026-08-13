// Редактор кода для страницы практики.
//
// Собирается esbuild-ом в out/assets/editor.js и кладётся рядом с сайтом:
// никаких внешних CDN, всё своё. Точка входа одна — window.CourseEditor.mount.
//
// Поле ввода на странице — обычная textarea, и она остаётся источником правды:
// CodeMirror лишь надстраивается над ней и переписывает её значение на каждое
// изменение. Если этот файл почему-то не загрузился, писать код всё равно
// можно — просто без подсветки.
import { python } from "@codemirror/lang-python";
import { EditorView, basicSetup } from "codemirror";

declare global {
  interface Window {
    CourseEditor?: { mount(textarea: HTMLTextAreaElement): void };
  }
}

function mount(textarea: HTMLTextAreaElement): void {
  const host = document.createElement("div");
  host.className = "code-editor";
  textarea.parentNode?.insertBefore(host, textarea);
  textarea.hidden = true;

  const view = new EditorView({
    parent: host,
    doc: textarea.value,
    extensions: [
      basicSetup,
      python(),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        textarea.value = update.state.doc.toString();
        // Событие руками: программная запись в textarea его не порождает, а
        // на нём висит автосохранение кода.
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    ],
  });

  // Сброс к заготовке меняет textarea снаружи — редактор должен это увидеть.
  textarea.addEventListener("course-editor-reset", () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: textarea.value },
    });
  });
}

window.CourseEditor = { mount };
