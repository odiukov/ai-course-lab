import { gradeAuto } from "../../lib/review/grade";
import type { CardRenderer } from "./types";

/**
 * Попыток перемешать заново, если перемешанный порядок совпал с исходным.
 *
 * Не `while`: когда все элементы совпадают по значению, ни одна перестановка
 * не отличается от исходной, и условие "совпало" никогда не станет ложным —
 * цикл крутился бы вечно. После потолка попыток принимаем то, что получилось.
 */
const MAX_SHUFFLE_ATTEMPTS = 5;

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * Расстановка шагов по порядку.
 *
 * Проверка вида не мертва: таблица RENDERERS гарантирует пару вид-отрисовщик,
 * но тип этого не выражает, и молчаливый выход оставил бы читателя перед
 * пустой карточкой без единой строки в консоли.
 */
export const order: CardRenderer = {
  mount(host, card, onAnswer) {
    if (card.kind !== "order") throw new Error(`ожидалась карточка order, пришла ${card.kind}`);

    const doc = host.ownerDocument;
    const question = doc.createElement("p");
    question.textContent = card.question;
    host.appendChild(question);

    let display = shuffled(card.items);
    for (let attempt = 0; sameOrder(display, card.items) && attempt < MAX_SHUFFLE_ATTEMPTS; attempt++) {
      display = shuffled(card.items);
    }

    /**
     * Выбранное видно списком по ходу дела.
     *
     * Без него единственным следом клика была бы погасшая кнопка, и человек
     * держал бы собственный порядок из шести шагов в голове — карточка
     * проверяла бы память о своих же нажатиях, а не знание материала.
     */
    const picks = doc.createElement("ol");
    picks.className = "review-picks";
    picks.dataset.picks = "";
    host.appendChild(picks);

    const picked: string[] = [];
    const buttons: HTMLButtonElement[] = [];
    /**
     * Карточка оценена — дальше ни клик, ни сброс ничего не меняют.
     *
     * Погасшие кнопки — защита для браузера, а этот признак — для кода: второй
     * вызов onAnswer означал бы второй расчёт срока и вторую панель разбора
     * поверх первой, и держаться такая гарантия на одном атрибуте DOM не должна.
     */
    let graded = false;

    /**
     * Сброс доступен до последнего выбора.
     *
     * Последний клик оценивает карточку и уезжает в планировщик, так что
     * отменять после него уже нечего; до него ошибка на втором шаге из шести
     * иначе означала бы гарантированное «неверно» и лишний провал в графике.
     */
    const reset = doc.createElement("button");
    reset.type = "button";
    reset.className = "review-reset";
    reset.dataset.reset = "";
    reset.textContent = "Начать заново";
    reset.disabled = true;
    reset.addEventListener("click", () => {
      if (graded) return;
      picked.length = 0;
      picks.replaceChildren();
      for (const button of buttons) button.disabled = false;
      reset.disabled = true;
    });

    display.forEach((label, index) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "review-item";
      button.dataset.item = String(index);
      button.textContent = label;
      button.addEventListener("click", () => {
        if (graded || button.disabled) return;
        // Кнопка гаснет сразу после своего клика: повторный клик по ней иначе
        // добавил бы элемент в ответ дважды.
        button.disabled = true;
        picked.push(label);

        const pick = doc.createElement("li");
        pick.className = "review-pick";
        pick.dataset.pick = String(picked.length);
        pick.textContent = label;
        picks.appendChild(pick);

        if (picked.length === card.items.length) {
          graded = true;
          reset.disabled = true;
          const correct = sameOrder(picked, card.items);
          onAnswer({ grade: gradeAuto(correct), correct });
        } else {
          reset.disabled = false;
        }
      });
      buttons.push(button);
      host.appendChild(button);
    });

    host.appendChild(reset);
  },
};
