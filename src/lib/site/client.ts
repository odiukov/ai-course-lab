import { HEIGHT_MESSAGE } from "../api/visual-height";
import { PROGRESS_KEY_PREFIX, STEP_STATE_KEY_PREFIX, UPDATED_AT_SUFFIX } from "./storage-keys";

// Реэкспорт ради тестов страниц, которые собирают ключ сами.
export { PROGRESS_KEY_PREFIX };

/**
 * Общая для всех страниц работа с прогрессом.
 *
 * Прогресс живёт в localStorage браузера: сервера у статики нет, и хранить
 * его негде больше. Отсюда же следует, что на другой машине прогресс свой —
 * это цена бесплатного хостинга, а не недосмотр.
 *
 * Любое обращение обёрнуто в try: в приватном окне Safari запись бросает, и
 * без обёртки на этом падал бы весь скрипт страницы, включая навигацию.
 */
const STORE = `
var PREFIX = ${JSON.stringify(PROGRESS_KEY_PREFIX)};

function readProgress(slug) {
  try {
    var raw = localStorage.getItem(PREFIX + slug);
    var parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function markRead(slug, stepId) {
  var ids = readProgress(slug);
  if (ids.indexOf(stepId) !== -1) return ids;
  ids.push(stepId);
  try {
    localStorage.setItem(PREFIX + slug, JSON.stringify(ids));
  } catch (error) {
    // Запись запрещена — прогресс просто не переживёт перезагрузку.
  }
  return ids;
}

function lessonData(selector) {
  var node = document.querySelector(selector);
  return node ? JSON.parse(node.textContent || "{}") : null;
}

var STATE_PREFIX = ${JSON.stringify(STEP_STATE_KEY_PREFIX)};

function readStates(slug) {
  try {
    var raw = localStorage.getItem(STATE_PREFIX + slug);
    var parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

/**
 * Состояние практики шага.
 *
 * passed не сбрасывается ничем: красный прогон после зелёного означает, что
 * человек полез что-то менять в уже сданном шаге, а не что шаг разучился.
 */
function markState(slug, stepId, state) {
  var rank = { read: 1, failed: 1, passed: 2 };
  var states = readStates(slug);
  if ((rank[states[stepId]] || 0) > (rank[state] || 0)) return states;
  states[stepId] = state;
  try {
    localStorage.setItem(STATE_PREFIX + slug, JSON.stringify(states));
  } catch (error) {
    // Приватное окно: состояние не переживёт перезагрузку.
  }
  if (window.CourseSync) window.CourseSync.putStep(slug, stepId, state);
  return states;
}
`;

/**
 * Страница шага: счётчик, полоска, галочки в оглавлении.
 *
 * «Прочитан» — это механически «ушёл с шага вперёд», ровно как в локальном
 * ридере: ни таймеров, ни глубины прокрутки. Отметка ставится по клику на
 * «Дальше» до перехода — запись в localStorage синхронная, уйти раньше неё
 * браузер не успеет.
 */
export const PROGRESS_SCRIPT = `
(function () {
${STORE}

var data = lessonData("[data-lesson]");
if (!data) return;

function paint(ids) {
  var read = {};
  for (var i = 0; i < ids.length; i += 1) read[ids[i]] = true;

  var counter = document.querySelector("[data-counter]");
  if (counter) {
    counter.textContent = data.number + " / " + data.plannedCount + " · прочитано " + ids.length;
  }

  var fill = document.querySelector("[data-progress-fill]");
  if (fill) {
    var share = data.plannedCount > 0 ? Math.round((ids.length / data.plannedCount) * 100) : 0;
    fill.style.width = share + "%";
  }

  var links = document.querySelectorAll("[data-step]");
  for (var j = 0; j < links.length; j += 1) {
    links[j].classList.toggle("is-read", !!read[links[j].getAttribute("data-step")]);
  }
}

paint(readProgress(data.slug));

// Прочитан — значит «ушёл с него». Любым способом: кнопкой «Дальше»,
// ссылкой из оглавления, ссылкой из текста, закрытой вкладкой.
//
// Раньше отметку ставил только клик по «Дальше», и у читателя, который ходил
// по оглавлению, счётчик навсегда оставался на нуле. pagehide ловит уход
// целиком, а клик по «Дальше» оставлен ради мгновенной отметки: счётчик и
// полоска должны шевельнуться под пальцем, а не после перехода.
var forward = document.querySelectorAll("[data-mark-read]");
for (var k = 0; k < forward.length; k += 1) {
  forward[k].addEventListener("click", function () {
    paint(markRead(data.slug, data.stepId));
  });
}

window.addEventListener("pagehide", function () {
  markRead(data.slug, data.stepId);
});

// Возврат к шагу, из текста которого сюда пришли.
//
// Откуда пришли, знает только referrer: адрес страницы про это молчит.
// Кнопка появляется, лишь если это был ДРУГОЙ шаг этого же урока и не сосед
// по чтению — с соседа сюда ведёт обычное «Дальше»/«Назад», и предлагать
// вернуться незачем. Уводит history.back(), чтобы попасть ровно в тот абзац,
// а не в начало шага.
(function () {
  var button = document.querySelector("[data-return]");
  if (!button || !document.referrer) return;

  var from;
  try {
    from = new URL(document.referrer);
  } catch (error) {
    return;
  }
  if (from.host !== window.location.host) return;

  var here = window.location.pathname.replace(/\\/+$/, "").split("/");
  var there = from.pathname.replace(/\\/+$/, "").split("/");
  var currentId = here.pop();
  var fromId = there.pop();
  if (!fromId || fromId === currentId) return;
  // Тот же урок: путь до последнего сегмента должен совпасть.
  if (here.join("/") !== there.join("/")) return;

  var link = document.querySelector('[data-step="' + fromId + '"]');
  if (!link) return;

  var index = -1;
  var links = document.querySelectorAll("[data-step]");
  var currentIndex = -1;
  for (var i = 0; i < links.length; i += 1) {
    if (links[i] === link) index = i;
    if (links[i].getAttribute("data-step") === currentId) currentIndex = i;
  }
  if (index === -1 || Math.abs(index - currentIndex) === 1) return;

  var number = link.querySelector(".toc-number");
  button.textContent = "← Вернуться к шагу " + (number ? number.textContent : "");
  button.hidden = false;
  button.addEventListener("click", function () {
    window.history.back();
  });
})();
})();
`;

/**
 * Оглавление урока: галочки прочитанного и кнопка «продолжить».
 *
 * Продолжить — это первый непрочитанный шаг, а не последний открытый: список
 * прочитанных не хранит порядок посещений, и «первый непрочитанный» —
 * единственный ответ, который из него честно выводится.
 */
export const LESSON_INDEX_SCRIPT = `
(function () {
${STORE}

var data = lessonData("[data-lesson]");
if (!data) return;

var ids = readProgress(data.slug);
var read = {};
for (var i = 0; i < ids.length; i += 1) read[ids[i]] = true;

var links = document.querySelectorAll("[data-step]");
var next = null;
for (var j = 0; j < links.length; j += 1) {
  var id = links[j].getAttribute("data-step");
  if (read[id]) links[j].classList.add("is-read");
  else if (!next) next = links[j];
}

var counter = document.querySelector("[data-read-count]");
if (counter) counter.textContent = "прочитано " + ids.length + " из " + data.plannedCount;

var resume = document.querySelector("[data-resume]");
if (resume) {
  var target = next || links[0];
  if (target) {
    resume.setAttribute("href", target.getAttribute("href"));
    resume.textContent = ids.length > 0 && next ? "Продолжить" : "Начать урок";
    resume.hidden = false;
  }
}
})();
`;

/**
 * Практика: редактор, прогон тестов, эталон.
 *
 * Python исполняется в браузере читателя — Pyodide, то есть CPython в
 * WebAssembly. Сервера у сайта нет и быть не может, так что чужой код никуда,
 * кроме своей вкладки, не дотянется.
 *
 * Всё тяжёлое грузится по требованию: Pyodide весит десяток мегабайт, и
 * тянуть его на шаге с теорией незачем.
 */
export const EXERCISE_SCRIPT = `
(function () {
${STORE}

var lesson = lessonData("[data-lesson]");

  var node = document.querySelector("[data-exercise]");
  if (!node) return;
  var data = JSON.parse(node.textContent || "{}");

  var area = document.querySelector("[data-code]");
  var runButton = document.querySelector("[data-run]");
  var resetButton = document.querySelector("[data-reset]");
  var solutionButton = document.querySelector("[data-show-solution]");
  var solutionBox = document.querySelector("[data-solution]");
  var status = document.querySelector("[data-run-status]");
  var results = document.querySelector("[data-results]");
  var contextPanel = document.querySelector("[data-context-panel]");
  var contextBox = document.querySelector("[data-context]");
  var consolePanel = document.querySelector("[data-console-panel]");
  var consoleOutput = document.querySelector("[data-console]");
  if (!area || !runButton) return;

  var activeFile = data.file ||
    (data.urls.files && data.urls.files.length > 0 ? data.urls.files[0].name : "exercise.py");
  var activeAsset = data.urls.files
    ? data.urls.files.filter(function (item) { return item.name === activeFile; })[0]
    : null;
  var templateUrl = activeAsset ? activeAsset.template : data.urls.template;
  var solutionUrl = activeAsset ? activeAsset.solution : data.urls.solution;
  function storageKeyFor(name) {
    return "course-exercise:" + data.slug + (data.multi ? ":" + name : "");
  }
  var legacyStorageKey = "course-exercise:" + data.slug;
  var storageKey = storageKeyFor(activeFile);
  var recoveryKey = storageKey + ":recovery";
  var template = "";
  // Полный файл упражнения. В редакторе видна только функция шага, но на
  // диск в браузере уезжает файл целиком: тесты импортируют из него все имена
  // сразу, и файл с одной функцией не загрузился бы вовсе.
  var full = "";
  // Границы видимой функции в полном файле фиксируются при загрузке страницы.
  // Искать функцию заново после каждого символа нельзя: учащийся может на
  // секунду переименовать is_symmetric в issymmetric, и тогда следующий
  // input уже не найдёт каноническое имя. Редактор покажет исправленный текст,
  // а hidden full останется со старой опечаткой — тесты проверят не то, что
  // видно на экране.
  var activeParts = null;

  /**
   * Делит файл на «до функции», саму функцию и «после».
   *
   * Границы ищутся по тексту, а не по номерам строк из сборки: файл живёт в
   * браузере и уже мог измениться — человек дописал функцию выше, и любые
   * заранее посчитанные номера уехали бы.
   */
  function split(source, fn) {
    var lines = source.split("\\n");
    var address = fn.split(".");
    var method = address.length === 2;
    var owner = method ? address[0] : null;
    var name = method ? address[1] : fn;
    var head = new RegExp("^(\\\\s*)(async\\\\s+)?def\\\\s+" + name + "\\\\s*\\\\(");
    var ownerStart = 0;
    var ownerEnd = lines.length;
    if (method) {
      var classHead = new RegExp("^class\\\\s+" + owner + "(?:\\\\s*\\\\(|\\\\s*:)");
      ownerStart = -1;
      for (var c = 0; c < lines.length; c += 1) {
        if (classHead.test(lines[c])) { ownerStart = c; break; }
      }
      if (ownerStart === -1) return null;
      for (var nextClass = ownerStart + 1; nextClass < lines.length; nextClass += 1) {
        if (/^(?:async\\s+def\\s|def\\s|class\\s)/.test(lines[nextClass])) {
          ownerEnd = nextClass;
          break;
        }
      }
    }
    var start = -1;
    for (var i = ownerStart; i < ownerEnd; i += 1) {
      if (head.test(lines[i])) { start = i; break; }
    }
    if (start === -1) return null;
    var methodIndent = (head.exec(lines[start]) || ["", ""])[1].length;

    // Конец блока — только НАСТОЯЩЕЕ следующее определение, а не любая строка
    // с левого края.
    //
    // Раньше границей считался левый край как таковой, и обломок вроде
    // «for x in v))», случайно оставшийся без отступа, оказывался снаружи
    // блока: замена функции его не трогала, файл навсегда переставал
    // разбираться, а в редакторе этой строки не видно. Теперь такой мусор
    // остаётся внутри блока и уходит вместе с ним.
    var boundary = /^(async\\s+def\\s|def\\s|class\\s|@|import\\s|from\\s|if\\s+__name__)/;
    var end = lines.length;
    for (var j = start + 1; j < lines.length; j += 1) {
      if (method) {
        if (lines[j].trim() === "") continue;
        var indent = (/^(\\s*)/.exec(lines[j]) || ["", ""])[1].length;
        if (indent < methodIndent ||
            (indent === methodIndent && /^\\s*(?:async\\s+def\\s|def\\s|@)/.test(lines[j]))) {
          end = j;
          break;
        }
      } else if (boundary.test(lines[j])) {
        end = j;
        break;
      }
    }
    while (end > start + 1 && lines[end - 1].trim() === "") end -= 1;

    return {
      before: lines.slice(0, start).join("\\n"),
      code: lines.slice(start, end).join("\\n"),
      after: lines.slice(end).join("\\n"),
    };
  }

  /** Границы метода внутри класса, включая его декораторы. */
  function methodSpan(lines, start, end, name) {
    var head = new RegExp("^(\\\\s*)(?:async\\\\s+)?def\\\\s+" + name + "\\\\s*\\\\(");
    var methodStart = -1;
    for (var i = start + 1; i < end; i += 1) {
      if (head.test(lines[i])) { methodStart = i; break; }
    }
    if (methodStart === -1) return null;

    var indent = (head.exec(lines[methodStart]) || ["", ""])[1];
    var methodEnd = end;
    for (var j = methodStart + 1; j < end; j += 1) {
      if (lines[j].trim() === "") continue;
      var currentIndent = (/^(\\s*)/.exec(lines[j]) || ["", ""])[1];
      if (currentIndent.length < indent.length ||
          (currentIndent.length === indent.length && /^\\s*(?:@|async\\s+def\\s|def\\s)/.test(lines[j]))) {
        methodEnd = j;
        break;
      }
    }

    while (methodStart > start + 1 &&
           lines[methodStart - 1].slice(0, indent.length) === indent &&
           lines[methodStart - 1].trim().startsWith("@")) {
      methodStart -= 1;
    }
    return { start: methodStart, end: methodEnd, indent: indent, name: name };
  }

  /** Контекст метода: только уже объявленная часть класса до текущего задания. */
  function enclosingClass(source, fn) {
    var address = fn.split(".");
    if (address.length !== 2) return null;

    var lines = source.split("\\n");
    var classHead = new RegExp("^class\\\\s+" + address[0] + "(?:\\\\s*\\\\(|\\\\s*:)");
    var start = -1;
    for (var i = 0; i < lines.length; i += 1) {
      if (classHead.test(lines[i])) { start = i; break; }
    }
    if (start === -1) return null;

    var end = lines.length;
    for (var j = start + 1; j < lines.length; j += 1) {
      // Декоратор следующего класса принадлежит уже ему. Если оставить его в
      // предыдущем контексте, у Budget внизу появляется одинокий @dataclass.
      if (/^(?:@|async\\s+def\\s|def\\s|class\\s)/.test(lines[j])) {
        end = j;
        break;
      }
    }

    var current = methodSpan(lines, start, end, address[1]);
    if (!current) return null;

    // Нижняя часть класса часто уже относится к следующим шагам. Например,
    // на _transition не нужны заготовки run/resume, а на Budget.exceeded нужны
    // только поля и объявленный выше remaining_seconds.
    var context = lines.slice(start, current.start)
      .concat([current.indent + "# Метод " + address[1] + " редактируется ниже."]);
    while (context.length > 1 && context[context.length - 1].trim() === "") context.pop();
    return context.join("\\n");
  }

  function join(source, fn, code) {
    var parts = split(source, fn);
    if (!parts) return source;
    return [parts.before, code, parts.after].join("\\n");
  }

  /**
   * Возвращает пропавшее каноническое имя, не стирая остальные функции.
   *
   * Частая опечатка — удалить или добавить подчёркивание в имени. Если такой
   * кандидат ровно один, сохраняем всё его тело и чиним только заголовок.
   * Для неизвестного переименования безопаснее добавить заготовку в конец:
   * прежний файл останется целиком, а не заменится всем шаблоном.
   */
  function restoreMissingFunction(source, templateSource, fn) {
    var normalized = fn.replace(/_/g, "").toLowerCase();
    var candidates = [];
    var head = /^(?:async\\s+)?def\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*\\(/gm;
    var match = null;
    while ((match = head.exec(source)) !== null) {
      var name = match[1];
      if (name !== fn && name.replace(/_/g, "").toLowerCase() === normalized) {
        candidates.push(name);
      }
    }

    if (candidates.length === 1) {
      var alias = candidates[0];
      var aliasParts = split(source, alias);
      if (aliasParts) {
        var aliasHead = new RegExp("^(async\\\\s+)?def\\\\s+" + alias + "\\\\s*\\\\(");
        var repaired = aliasParts.code.replace(aliasHead, function (_, asyncPrefix) {
          return (asyncPrefix || "") + "def " + fn + "(";
        });
        return join(source, alias, repaired);
      }
    }

    var fresh = split(templateSource, fn);
    if (!fresh) return source;
    if (fn.indexOf(".") !== -1) {
      var className = fn.split(".")[0];
      var lines = source.split("\\n");
      var classHead = new RegExp("^class\\\\s+" + className + "(?:\\\\s*\\\\(|\\\\s*:)");
      var classStart = -1;
      var classEnd = lines.length;
      for (var i = 0; i < lines.length; i += 1) {
        if (classHead.test(lines[i])) { classStart = i; break; }
      }
      if (classStart !== -1) {
        for (var j = classStart + 1; j < lines.length; j += 1) {
          if (/^(?:async\\s+def\\s|def\\s|class\\s)/.test(lines[j])) {
            classEnd = j;
            break;
          }
        }
        lines.splice(classEnd, 0, "", fresh.code);
        return lines.join("\\n");
      }
      return source;
    }
    return source.replace(/\\s+$/, "") + "\\n\\n" + fresh.code + "\\n";
  }

  function save() {
    if (activeParts) {
      activeParts.code = area.value;
      full = [activeParts.before, activeParts.code, activeParts.after].join("\\n");
    } else {
      full = join(full, data.fn, area.value);
    }
    try {
      localStorage.setItem(storageKey, full);
      localStorage.setItem(storageKey + ${JSON.stringify(UPDATED_AT_SUFFIX)}, new Date().toISOString());
    } catch (error) {
      // Приватное окно: код не переживёт перезагрузку, писать всё равно можно.
    }
    if (window.CourseSync) window.CourseSync.putFile(data.slug, activeFile, full);
  }

  function setCode(text) {
    area.value = text;
    // Редактор, если он поднялся, слушает это событие и подхватывает текст.
    area.dispatchEvent(new Event("course-editor-reset"));
  }

  function text(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error("не удалось загрузить " + url);
      return response.text();
    });
  }

  // Заготовка нужна всегда: по ней работает «Сбросить».
  text(templateUrl).then(function (source) {
    template = source;
    var saved = null;
    try {
      saved = localStorage.getItem(storageKey);
      // Первая опубликованная многофайловая версия хранила main.py под
      // старым ключом без имени файла. Подхватываем его один раз, чтобы
      // исправление вкладок не стоило человеку уже написанного метода.
      if (saved === null && data.multi) saved = localStorage.getItem(legacyStorageKey);
    } catch (error) {
      saved = null;
    }
    full = saved === null ? source : saved;

    var parts = split(full, data.fn);
    var classSource = enclosingClass(full, data.fn);
    if (contextPanel && contextBox && classSource) {
      contextBox.textContent = classSource;
      contextPanel.hidden = false;
    }
    // Сохранённого файла не хватает: функции шага в нём нет вовсе. Такой файл
    // раньше целиком заменялся заготовкой, и написанные на прошлых шагах
    // функции исчезали. Сначала сохраняем исходник отдельно, затем чиним
    // только текущую функцию, не трогая остальные участки файла.
    if (!parts) {
      if (saved !== null) {
        try {
          localStorage.setItem(recoveryKey, saved);
        } catch (error) {
          // Даже без backup продолжаем в памяти: приватный режим не должен
          // снова превращать локальную опечатку в сброс всего упражнения.
        }
      }
      full = restoreMissingFunction(full, source, data.fn);
      parts = split(full, data.fn);
      if (parts) {
        try {
          localStorage.setItem(storageKey, full);
        } catch (error) {
          // В приватном режиме отремонтированный текст проживёт хотя бы вкладку.
        }
      }
    }
    // Повреждён даже шаблон — только тогда остаётся последний аварийный путь.
    if (!parts) {
      full = source;
      parts = split(full, data.fn);
    }
    activeParts = parts;
    setCode(parts ? parts.code : full);
    if (window.CourseEditor) window.CourseEditor.mount(area);
  });

  area.addEventListener("input", save);

  if (resetButton) {
    resetButton.addEventListener("click", function () {
      if (!template) return;
      if (!window.confirm("Вернуть заготовку этой функции? Написанный код пропадёт.")) return;
      // Сбрасывается только функция шага: остальное в файле человек писал на
      // других шагах, и терять это из-за одной кнопки он не подписывался.
      var fresh = split(template, data.fn);
      setCode(fresh ? fresh.code : template);
      save();
    });
  }

  if (solutionButton && solutionBox && solutionUrl) {
    solutionButton.addEventListener("click", function () {
      if (!solutionBox.hidden) {
        solutionBox.hidden = true;
        solutionButton.textContent = "Показать решение";
        return;
      }
      text(solutionUrl).then(function (source) {
        var answer = split(source, data.fn);
        solutionBox.textContent = answer ? answer.code : source;
        solutionBox.hidden = false;
        solutionButton.textContent = "Скрыть решение";
      });
    });
  } else if (solutionButton) {
    solutionButton.hidden = true;
  }

  var pyodidePromise = null;

  function loadPyodideOnce() {
    if (pyodidePromise) return pyodidePromise;

    pyodidePromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = data.assets.pyodide + "pyodide.js";
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("не удалось загрузить Python"));
      };
      document.head.appendChild(script);
    })
      .then(function () {
        return window.loadPyodide({ indexURL: data.assets.pyodide });
      })
      .then(function (pyodide) {
        return Promise.all([
          text(data.assets.harness),
          data.multi ? Promise.resolve(null) : text(data.urls.test),
        ]).then(function (files) {
          pyodide.FS.mkdirTree("/exercise");
          if (files[1] !== null) {
            pyodide.FS.writeFile("/exercise/test_exercise.py", files[1]);
          }
          pyodide.runPython(files[0]);
          return pyodide;
        });
      })
      .catch(function (error) {
        // Неудачную загрузку нельзя оставлять в памяти: иначе каждая
        // следующая попытка мгновенно спотыкается о тот же отказ, и кнопка
        // «Запустить тесты» перестаёт работать до перезагрузки страницы.
        pyodidePromise = null;
        throw error;
      });

    return pyodidePromise;
  }

  function render(report) {
    results.innerHTML = "";
    if (consolePanel && consoleOutput) {
      consoleOutput.textContent = report.output || "(вывода нет)";
      consolePanel.hidden = false;
    }
    if (report.loadError) {
      // Статус обязан смениться: без этого на экране остаётся «Гоняю тесты…»,
      // и прогон выглядит зависшим, хотя он давно закончился ошибкой.
      status.className = "run-status";
      status.textContent = "Файл упражнения не разобрался — Python остановился на этом месте:";

      var problem = document.createElement("p");
      problem.className = "run-error";
      problem.textContent = report.loadError;
      results.appendChild(problem);

      // Файл не разобрался, а видно в редакторе только одну функцию: ошибка
      // вполне может сидеть в другой части файла — например, осталась от
      // прежних правок. Дать выход, а не оставлять человека гадать.
      var rescue = document.createElement("button");
      rescue.type = "button";
      rescue.className = "nav-button";
      rescue.textContent = "Сбросить весь файл упражнения";
      rescue.addEventListener("click", function () {
        if (!template) return;
        if (!window.confirm("Вернуть всё упражнение к заготовке? Пропадёт код и других шагов.")) {
          return;
        }
        full = template;
        var fresh = split(full, data.fn);
        activeParts = fresh;
        setCode(fresh ? fresh.code : full);
        save();
        results.innerHTML = "";
        if (consolePanel && consoleOutput) {
          consoleOutput.textContent = "";
          consolePanel.hidden = true;
        }
        status.textContent = "Упражнение сброшено к заготовке.";
      });
      results.appendChild(rescue);
      return;
    }

    var passed = 0;
    var list = document.createElement("ul");
    list.className = "test-list";
    for (var i = 0; i < report.results.length; i += 1) {
      var item = report.results[i];
      if (item.passed) passed += 1;
      var row = document.createElement("li");
      row.className = item.passed ? "test is-passed" : "test is-failed";
      row.textContent = (item.passed ? "✓ " : "✗ ") + item.name + (item.message ? " — " + item.message : "");
      list.appendChild(row);
    }

    var total = report.results.length;
    status.textContent =
      passed + " из " + total + " зелёные" +
      (report.filtered ? "" : " (тесты этого шага не нашлись — прогнали всё упражнение)");
    status.className = passed === total && total > 0 ? "run-status is-passed" : "run-status";
    if (lesson && total > 0) {
      var verdict = passed === total ? "passed" : "failed";
      markState(lesson.slug, lesson.stepId, verdict);
      if (window.CourseSync) {
        window.CourseSync.putRun(lesson.slug, lesson.stepId, passed, total - passed);
      }
    }
    results.appendChild(list);
  }

  function runtimePayload() {
    if (!data.multi) return Promise.resolve({ files: null, tests: null });
    var fileAssets = data.urls.files || [];
    var testAssets = data.urls.tests || [];
    return Promise.all([
      Promise.all(fileAssets.map(function (item) {
        if (item.name === activeFile) return Promise.resolve([item.name, full]);
        var saved = null;
        try {
          saved = localStorage.getItem(storageKeyFor(item.name));
        } catch (error) {
          saved = null;
        }
        return saved === null
          ? text(item.template).then(function (source) { return [item.name, source]; })
          : Promise.resolve([item.name, saved]);
      })),
      Promise.all(testAssets.map(function (item) {
        return text(item.url).then(function (source) { return [item.name, source]; });
      })),
    ]).then(function (groups) {
      var files = {};
      var tests = {};
      groups[0].forEach(function (item) { files[item[0]] = item[1]; });
      groups[1].forEach(function (item) { tests[item[0]] = item[1]; });
      return { files: files, tests: tests };
    });
  }

  runButton.addEventListener("click", function () {
    runButton.disabled = true;
    if (consolePanel && consoleOutput) {
      consoleOutput.textContent = "";
      consolePanel.hidden = true;
    }
    status.className = "run-status";
    status.textContent = "Готовлю Python…";

    loadPyodideOnce()
      .then(function (pyodide) {
        status.textContent = "Гоняю тесты…";
        // Синхронизируем полный файл прямо перед прогоном. Обычно это уже
        // сделал input, но кнопка не должна зависеть от порядка браузерных
        // событий или от конкретной реализации редактора.
        save();
        // В Python уезжает файл целиком, а не то, что в редакторе: тесты
        // импортируют из него все имена упражнения разом.
        return runtimePayload().then(function (runtime) {
          pyodide.globals.set(
            "PAYLOAD",
            JSON.stringify({
              code: full,
              fn: data.fn,
              functions: data.functions,
              files: runtime.files,
              tests: runtime.tests,
              testNodes: data.testNodes || [],
            })
          );
          return JSON.parse(pyodide.runPython("run_json(PAYLOAD)"));
        });
      })
      .then(render)
      .catch(function (error) {
        status.className = "run-status";
        status.textContent = String(error && error.message ? error.message : error);
      })
      .then(function () {
        runButton.disabled = false;
      });
  });
})();
`;

/** Каталог: сколько шагов урока прочитано в этом браузере. */
export const CATALOG_SCRIPT = `
(function () {
${STORE}

var rows = document.querySelectorAll("[data-lesson-slug]");
for (var i = 0; i < rows.length; i += 1) {
  var slug = rows[i].getAttribute("data-lesson-slug");
  var count = readProgress(slug).length;
  if (count === 0) continue;

  var target = rows[i].querySelector("[data-read]");
  if (!target) continue;
  target.textContent = "прочитано " + count;
  target.hidden = false;
}
})();
`;

/**
 * Проверка ответов в браузере.
 *
 * Верный вариант лежит рядом в JSON: сервера у статики нет, прятать ответ не
 * от кого и незачем. Шаг считается сданным, когда верно отвечены все вопросы
 * блока — состояние идёт в то же хранилище, что и прогон тестов упражнения.
 */
export const QUIZ_SCRIPT = `
(function () {
${STORE}

var lesson = lessonData("[data-lesson]");

document.querySelectorAll("[data-quiz]").forEach(function (root) {
  var source = root.querySelector("[data-quiz-answers]");
  if (!source) return;
  var answers = JSON.parse(source.textContent || "[]");
  // Шаг сдан, когда верно отвечены все вопросы блока, а не первый попавшийся.
  var correct = {};
  var total = root.querySelectorAll("[data-question]").length;

  root.querySelectorAll("[data-question]").forEach(function (question) {
    var index = Number(question.getAttribute("data-question"));
    var answer = answers[index];
    if (!answer) return;
    var explanation = question.querySelector("[data-explanation]");

    question.querySelectorAll("[data-option]").forEach(function (button) {
      button.addEventListener("click", function () {
        var chosen = Number(button.getAttribute("data-option"));
        question.querySelectorAll("[data-option]").forEach(function (other) {
          other.classList.remove("is-chosen", "is-wrong");
          if (Number(other.getAttribute("data-option")) === answer.correct) {
            other.classList.add("is-correct");
          }
        });
        button.classList.add(chosen === answer.correct ? "is-chosen" : "is-wrong");
        if (explanation && answer.explanation) {
          explanation.textContent = answer.explanation;
          explanation.hidden = false;
        }
        if (!lesson) return;
        if (chosen === answer.correct) {
          correct[index] = true;
          if (Object.keys(correct).length === total) {
            markState(lesson.slug, lesson.stepId, "passed");
          }
        } else {
          // Вопрос мог уже засчитаться верным раньше — переклик неверным
          // вариантом должен снять эту засечку, иначе следующий верный ответ
          // на другой вопрос ошибочно и необратимо сдаст весь шаг.
          delete correct[index];
          markState(lesson.slug, lesson.stepId, "failed");
        }
      });
    });
  });
});
})();
`;

/**
 * Высота рамки со схемой — по сообщению от самой схемы.
 *
 * Тот же протокол, что в VisualFrame: отправитель сверяется по contentWindow
 * (origin у песочницы обнулён, и сверку по нему подделать нельзя), высота
 * зажимается теми же границами.
 */
export const FRAME_SCRIPT = `
window.addEventListener("message", function (event) {
  var data = event.data;
  if (!data || data.type !== ${JSON.stringify(HEIGHT_MESSAGE)}) return;
  var value = Number(data.height);
  if (!isFinite(value)) return;

  var frames = document.querySelectorAll("iframe[data-visual]");
  for (var i = 0; i < frames.length; i += 1) {
    if (frames[i].contentWindow !== event.source) continue;
    frames[i].style.height = Math.min(Math.max(Math.ceil(value), 160), 5200) + "px";
    return;
  }
});
`;

/**
 * Страница `/auth/`: показать итог входа и увести обратно.
 *
 * Адрес возврата приходит строкой запроса, поэтому проверяется на то, что это
 * путь внутри самого сайта: без проверки страница входа превращается в
 * открытый редирект на чужой сайт.
 */
export const AUTH_PAGE_SCRIPT = `
(function () {
  var status = document.querySelector("[data-auth-status]");
  var base = document.body.getAttribute("data-base") || "";

  function safeNext() {
    var raw = new URLSearchParams(window.location.search).get("next");
    if (!raw) return base + "/";
    // Решение принимается по разобранному адресу, а не по исходной строке.
    // Разбор выбрасывает табуляцию и переводы строк и выпрямляет обратные
    // косые, поэтому проверять строку посимвольно бесполезно: "/\\t//чужой"
    // выглядит путём, а браузер уводит по нему на чужой сайт. Сверка идёт с
    // тем же адресом, по которому потом и произойдёт переход.
    var url;
    try {
      url = new URL(raw, window.location.origin);
    } catch (error) {
      return base + "/";
    }
    if (url.origin !== window.location.origin) return base + "/";
    if (base && url.pathname.indexOf(base + "/") !== 0) return base + "/";
    return url.pathname + url.search + url.hash;
  }

  window.addEventListener("course-sync-ready", function (event) {
    var detail = event.detail || {};
    if (!detail.user) {
      if (status) status.textContent = "Войти не удалось: " + (detail.error || "неизвестная причина");
      return;
    }
    // Сорвавшееся слияние не молчит: флаг при отказе не ставится, и следующий
    // заход попробует снова — но узнать об этом человек должен здесь.
    if (status) {
      status.textContent = detail.error
        ? "Вход выполнен, но прогресс с этого устройства влить не удалось: " + detail.error +
          ". Попробуется снова при следующем заходе."
        : detail.migrated
          ? "Прогресс с этого устройства влит в аккаунт: шагов " + detail.steps +
            ", файлов " + detail.files +
            (detail.backups > 0 ? ", отложено копий кода " + detail.backups : "")
          : "Вход выполнен.";
    }
    window.setTimeout(function () {
      window.location.replace(safeNext());
    }, detail.error || detail.backups > 0 ? 4000 : 1200);
  });
})();
`;
