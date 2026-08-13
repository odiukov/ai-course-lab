import { HEIGHT_MESSAGE } from "../api/visual-height";

/**
 * Проверка ответов в браузере.
 *
 * Верный вариант лежит рядом в JSON: сервера у статики нет, прятать ответ не
 * от кого и незачем. Ничего не сохраняется — прогресс остаётся свойством
 * локального приложения.
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
