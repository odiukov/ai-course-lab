"use client";

import { useEffect, useRef, useState } from "react";
import { HEIGHT_MESSAGE } from "@/lib/api/visual-height";

// Пока схема не сказала свою высоту, рамка держит прежние 520px: так выглядят
// и первые кадры загрузки, и схема, которая по какой-то причине не отчиталась.
const FALLBACK_HEIGHT = 520;
// Нижняя граница — от схемы, которая на миг померила себя пустой (шрифты и
// разметка ещё не встали). Верхняя — от схемы с бесконечной анимацией, которая
// растёт от собственного отчёта: без потолка такая утянула бы страницу в
// бесконечность.
//
// 2400 оказалось мало: часть схем курса — не диаграмма к шагу, а мини-
// приложение на весь урок (lesson-01-vectors: пять разделов, девять ползунков,
// 4740 пикселей). Потолок резал их, и внутри рамки появлялся свой скролл,
// который на странице урока перехватывает колесо. 5200 вмещает самую большую
// настоящую схему и по-прежнему ловит убегающую.
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 5200;

export function VisualFrame({ src, title }: { src: string; title: string }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(FALLBACK_HEIGHT);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Отправитель сверяется по окну, а не по origin: схема живёт в песочнице
      // без own-origin, и её origin в сообщении — "null". Совпадение по
      // contentWindow означает «это сообщение прислала ровно эта рамка», чего
      // чужая вкладка подделать не может.
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (!data || data.type !== HEIGHT_MESSAGE) return;

      const value = Number(data.height);
      if (!Number.isFinite(value)) return;
      setHeight(Math.min(Math.max(Math.ceil(value), MIN_HEIGHT), MAX_HEIGHT));
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={frame}
      src={src}
      sandbox="allow-scripts"
      style={{ height }}
      className="my-6 w-full rounded-lg border border-slate-200 dark:border-slate-700"
      title={title}
    />
  );
}
