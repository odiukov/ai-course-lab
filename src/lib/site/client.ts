import { HEIGHT_MESSAGE } from "../api/visual-height";

/** Префикс ключа localStorage: на каждый урок свой список прочитанных шагов. */
export const PROGRESS_KEY_PREFIX = "course-progress:";

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
 * от кого и незачем. Ничего не сохраняется — в прогресс идут только шаги.
 */
export const QUIZ_SCRIPT = `
document.querySelectorAll("[data-quiz]").forEach(function (root) {
  var source = root.querySelector("[data-quiz-answers]");
  if (!source) return;
  var answers = JSON.parse(source.textContent || "[]");

  root.querySelectorAll("[data-question]").forEach(function (question) {
    var answer = answers[Number(question.getAttribute("data-question"))];
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
      });
    });
  });
});
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
