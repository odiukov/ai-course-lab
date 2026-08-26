import { gradeAuto } from "../../lib/review/grade";
import type { CardRenderer } from "./types";

/** `trim` + нижний регистр + схлопнутые пробелы: "AXIS = -1" и "axis=-1" — один ответ. */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Пропуск в строке кода.
 *
 * Проверка вида не мертва: таблица RENDERERS гарантирует пару вид-отрисовщик,
 * но тип этого не выражает, и молчаливый выход оставил бы читателя перед
 * пустой карточкой без единой строки в консоли.
 */
export const cloze: CardRenderer = {
  mount(host, card, onAnswer) {
    if (card.kind !== "cloze") throw new Error(`ожидалась карточка cloze, пришла ${card.kind}`);

    const doc = host.ownerDocument;
    const question = doc.createElement("p");
    question.textContent = card.question;
    host.appendChild(question);

    // Шаблон приходит одной строкой с "___" внутри — разрезаем по нему и
    // вставляем поле ввода в разрез, а не рядом с текстом.
    //
    // Хвост склеивается обратно, а не берётся вторым элементом разреза: схема
    // требует от шаблона только наличие "___", так что пропусков может быть и
    // два. Поле ввода остаётся одно — второй пропуск показывается как есть, —
    // но взять из разреза ровно две части значило бы молча потерять всё после
    // второго пропуска, и читателя оценивали бы по строке кода без конца.
    const [before, ...rest] = card.template.split("___");
    const line = doc.createElement("p");
    line.className = "review-template";
    line.appendChild(doc.createTextNode(before));

    const input = doc.createElement("input");
    input.type = "text";
    input.className = "review-input";
    line.appendChild(input);

    line.appendChild(doc.createTextNode(rest.join("___")));
    host.appendChild(line);

    const accepted = [card.answer, ...card.accept].map(normalize);

    const submit = doc.createElement("button");
    submit.type = "button";
    submit.className = "review-submit";
    submit.dataset.submit = "";
    submit.textContent = "Ответить";
    submit.addEventListener("click", () => {
      // Поле и кнопка гаснут после ответа: второй клик иначе пересчитал бы
      // оценку и уехал бы вторым вызовом onAnswer.
      input.disabled = true;
      submit.disabled = true;
      const correct = accepted.includes(normalize(input.value));
      onAnswer({ grade: gradeAuto(correct), correct });
    });
    host.appendChild(submit);
  },
};
