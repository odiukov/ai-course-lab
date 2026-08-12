/** Имя сообщения, которым схема сообщает свою высоту рамке вокруг неё. */
export const HEIGHT_MESSAGE = "lab-visual-height";

// Мерка, которая подшивается в каждую схему.
//
// Читать высоту снаружи нельзя: iframe стоит с `sandbox="allow-scripts"` без
// `allow-same-origin`, то есть в отдельном origin, и `contentDocument` для
// страницы урока закрыт. Снимать эту защиту ради высоты нельзя тем более —
// схемы генерируются, и вместе с доступом к документу они получили бы доступ
// к самой странице урока. Поэтому меряет себя схема сама, а наружу отдаёт
// одно число.
//
// `"*"` вместо адреса получателя — потому что origin у песочницы обнулён и
// адреса страницы урока схема не знает. Наружу уходит одно число (высота), а
// рамка сверяет отправителя по `contentWindow`, а не по origin.
//
// ResizeObserver — не роскошь: в схемах есть ползунки, от которых разметка
// меняет высоту уже после загрузки.
// Меряется НИЖНИЙ КРАЙ СОДЕРЖИМОГО, а не scrollHeight.
//
// scrollHeight никогда не бывает меньше окна, в котором документ показан, а
// окно здесь — сама рамка. Схема на 350 пикселей внутри рамки на 520 меряла
// себе 520 и отдавала это наружу: рамка подтверждала собственную высоту, и
// та навсегда залипала на запасной, оставляя под рисунком полторы сотни
// пустых пикселей. Замкнутый круг разрывается тем, что содержимое о высоте
// окна ничего не знает.
const REPORTER = `<script>
(function () {
  function contentHeight() {
    var body = document.body;
    if (!body) return 0;

    var bottom = body.getBoundingClientRect().bottom;
    var nodes = body.getElementsByTagName("*");
    for (var i = 0; i < nodes.length; i += 1) {
      var box = nodes[i].getBoundingClientRect();
      // Схлопнутые и спрятанные узлы пропускаются: у скрытого запасного
      // текста нулевая коробка, но она всё равно где-то «заканчивается».
      if (box.width > 0 || box.height > 0) bottom = Math.max(bottom, box.bottom);
    }

    var style = window.getComputedStyle(body);
    return bottom + (parseFloat(style.marginBottom) || 0);
  }

  function report() {
    parent.postMessage(
      { type: "${HEIGHT_MESSAGE}", height: Math.ceil(contentHeight()) },
      "*"
    );
  }

  report();
  window.addEventListener("load", report);
  if (window.ResizeObserver) new ResizeObserver(report).observe(document.documentElement);
})();
</script>`;

/**
 * Подшивает к схеме скрипт, который сообщает наружу её высоту.
 *
 * Делается на сервере, а не в самих файлах схем: схем много, часть из них
 * генерируется на лету, и требовать от каждой помнить про мерку — значит
 * получить схемы, которые про неё забыли.
 */
export function withHeightReporter(html: string): string {
  // Последний `</body>`, а не первый: схема про HTML может показывать этот тег
  // как текст, и мерка уехала бы в середину документа.
  const close = html.toLowerCase().lastIndexOf("</body>");
  if (close === -1) return `${html}\n${REPORTER}`;
  return `${html.slice(0, close)}${REPORTER}${html.slice(close)}`;
}
