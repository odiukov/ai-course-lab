// Мост между браузером и pyright-langserver.
//
// Браузер ⟷ мост: одно сообщение WebSocket = один JSON-RPC объект.
// Мост ⟷ pyright: кадры Content-Length по stdio.
//
// Запуск: npx tsx scripts/lsp-bridge.mts   (или npm run dev:lsp)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { FrameReader, encodeFrame } from "../src/lib/lsp/framing.js";

const port = Number(process.env.LSP_PORT ?? 3001) || 3001;
const server = path.join(process.cwd(), "node_modules", ".bin", "pyright-langserver");

if (!fs.existsSync(server)) {
  console.error(`pyright-langserver не найден: ${server}. Поставь зависимости: npm install`);
  process.exit(1);
}

const http1 = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, pyright: server }));
    return;
  }
  response.writeHead(404).end();
});

const sockets = new WebSocketServer({ server: http1 });

// Живые pyright'ы — по одному на подключение. Список нужен, чтобы прибить
// их всех, если сам мост умирает (Ctrl+C, `npm run dev` останавливает оба
// процесса): без этого закрытие моста не значит закрытие сокета, и один
// потерянный дочерний процесс переживёт родителя.
const children = new Set<ReturnType<typeof spawn>>();

sockets.on("connection", (socket: WebSocket) => {
  const child = spawn(server, ["--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
  children.add(child);
  const reader = new FrameReader();

  child.stdout.on("data", (chunk: Buffer) => {
    for (const message of reader.push(chunk)) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    }
  });

  // stderr сервера — в консоль сайдкара: единственное место, где видно, что
  // pyright ругается на конфигурацию, а не молчит.
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[pyright] ${chunk}`));

  child.on("error", (error) => {
    console.error(`[pyright] не запустился: ${error.message}`);
    socket.close();
  });
  child.on("close", (code) => {
    children.delete(child);
    if (socket.readyState === socket.OPEN) socket.close(1011, `pyright вышел с кодом ${code}`);
  });

  // Без этого listener'а EPIPE (запись в stdin уже мёртвого pyright'а) валит
  // весь процесс моста необработанным исключением — а с ним ложится только
  // это одно соединение, что и есть требование.
  child.stdin.on("error", (error) => {
    console.error(`[pyright] stdin умер: ${error.message}`);
    socket.close();
  });

  socket.on("message", (data) => {
    // Дочерний процесс мог уже умереть (или его stdin закрылся) в промежутке
    // между уходом старого сообщения и приходом нового — 'close' ещё не
    // долетел. Пишем только если писать реально можно, а не наперегонки с
    // обработчиком ошибки выше.
    if (child.exitCode !== null || child.killed || !child.stdin.writable) return;
    try {
      child.stdin.write(encodeFrame(JSON.parse(String(data))));
    } catch {
      console.error("[pyright] сообщение от браузера не разобралось как JSON — пропущено");
    }
  });

  // Тот же класс проблемы с другой стороны: резкий обрыв соединения браузером
  // (ECONNRESET, без штатного close) тоже эмиттит 'error' на сокете. Без
  // listener'а это тоже необработанное исключение. Дальше делает своё дело
  // обычный 'close' — WebSocket эмиттит его и после ошибки.
  socket.on("error", (error) => {
    console.error(`[bridge] сокет клиента упал: ${error.message}`);
  });

  // Один клиент — один сервер: закрытая вкладка убивает процесс, иначе за
  // вечер набирается десяток висящих pyright'ов по полгигабайта каждый.
  socket.on("close", () => {
    children.delete(child);
    child.kill();
  });
});

http1.listen(port, "127.0.0.1", () => {
  console.log(`pyright-мост слушает ws://127.0.0.1:${port}`);
});

// Мост тоже может умереть не через закрытие сокета — Ctrl+C или
// `npm run dev`, который останавливает оба процесса сразу. В обоих случаях
// оставшихся pyright'ов надо прибить, а не оставить сиротами. Убивает их
// только 'exit' — сигналам достаточно попросить процесс завершиться.
process.on("exit", () => {
  for (const child of children) child.kill();
});
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
