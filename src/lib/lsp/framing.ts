const SEPARATOR = "\r\n\r\n";

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}${SEPARATOR}`, "utf8");
  return Buffer.concat([header, body]);
}

/**
 * Собирает JSON-RPC сообщения из потока байтов stdout языкового сервера.
 *
 * Держит хвост между вызовами: сервер пишет когда ему удобно, и один кадр
 * приезжает двумя чанками так же часто, как два кадра одним.
 */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];

    for (;;) {
      const separator = this.buffer.indexOf(SEPARATOR, 0, "utf8");
      if (separator === -1) break;

      const header = this.buffer.subarray(0, separator).toString("utf8");
      const match = /content-length:\s*(\d+)/i.exec(header);
      const bodyStart = separator + SEPARATOR.length;

      if (!match) {
        // Заголовка длины нет — читать дальше нечего: выбрасываем этот блок и
        // ищем следующий разделитель, иначе цикл встанет навсегда.
        this.buffer = this.buffer.subarray(bodyStart);
        continue;
      }

      const length = Number(match[1]);
      if (this.buffer.length < bodyStart + length) break;

      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        messages.push(JSON.parse(body));
      } catch {
        // Битое тело — не повод потерять всё, что придёт после него.
      }
    }

    return messages;
  }
}
