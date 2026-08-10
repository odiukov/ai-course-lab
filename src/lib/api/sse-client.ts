export interface SseFrame {
  event: string;
  data: unknown;
}

// Разбирает столько полных кадров, сколько накопилось в буфере, и возвращает
// хвост, который ещё не завершился пустой строкой. Вызывающий обязан класть
// этот хвост в начало следующего буфера, иначе кадр, разрезанный границей
// чанка, потеряется.
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const chunks = buffer.split("\n\n");
  const rest = chunks.pop() ?? "";
  const frames: SseFrame[] = [];

  for (const chunk of chunks) {
    let event = "message";
    const dataLines: string[] = [];

    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        // Ровно один ведущий пробел — по спецификации SSE; всё остальное
        // принадлежит данным, а JSON.parse и так переживёт лишние отступы.
        dataLines.push(line.slice("data:".length).replace(/^ /, ""));
      }
    }

    if (dataLines.length === 0) continue;
    try {
      frames.push({ event, data: JSON.parse(dataLines.join("\n")) });
    } catch {
      continue;
    }
  }

  return { frames, rest };
}
