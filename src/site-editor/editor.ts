// Редактор кода для страницы практики.
//
// Собирается esbuild-ом в out/assets/editor.js и кладётся рядом с сайтом:
// никаких внешних CDN, всё своё. Точка входа одна — window.CourseEditor.mount.
//
// Поле ввода на странице — обычная textarea, и она остаётся источником правды:
// CodeMirror лишь надстраивается над ней и переписывает её значение на каждое
// изменение. Если этот файл почему-то не загрузился, писать код всё равно
// можно — просто без подсветки.
import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import { EditorView, basicSetup } from "codemirror";

// Что подсказывать помимо слов самого файла. Упражнения курса живут на голой
// стандартной библиотеке, поэтому список короткий и покрывает почти всё, что
// в них вообще встречается.
const PYTHON_WORDS = [
  "abs", "all", "any", "bool", "dict", "enumerate", "filter", "float", "int", "len", "list",
  "map", "max", "min", "range", "round", "set", "sorted", "sum", "str", "tuple", "zip",
  "math.sqrt", "math.pi", "math.exp", "math.log", "math.sin", "math.cos", "math.acos",
  "math.isclose", "math.inf", "random.random", "random.randint", "random.gauss",
  "ValueError", "TypeError", "ZeroDivisionError", "NotImplementedError",
];

/**
 * Подсказки: слова из этого же файла плюс короткий список из стандартной
 * библиотеки.
 *
 * Настоящая подсказка по сигнатуре требует языкового сервера — в локальном
 * приложении её даёт pyright, которому нужен процесс на машине. На статике
 * такого нет, поэтому здесь честный минимум: дописать имя, а что функция
 * принимает — написано в её докстроке прямо в редакторе.
 */
function completions(context: CompletionContext) {
  const word = context.matchBefore(/[\w.]+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const seen = new Set(PYTHON_WORDS);
  for (const match of context.state.doc.toString().matchAll(/[A-Za-z_][\w]*/g)) {
    seen.add(match[0]);
  }

  return {
    from: word.from,
    options: [...seen].map((label) => ({ label, type: "variable" })),
  };
}

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

  // Тема выбирается под тему страницы: подсветка, рассчитанная на белый фон,
  // на чёрном превращается в красное по чёрному.
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  const view = new EditorView({
    parent: host,
    doc: textarea.value,
    extensions: [
      basicSetup,
      python(),
      // Без этого Tab уводит фокус на следующую кнопку — поведение, полезное
      // на форме и невыносимое в редакторе кода с отступами.
      keymap.of([indentWithTab]),
      autocompletion({ override: [completions] }),
      ...(dark ? [oneDark] : []),
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
