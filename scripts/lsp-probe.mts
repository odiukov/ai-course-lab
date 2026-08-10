// Проверка моста без браузера: поднимает документ с заведомой ошибкой и
// печатает диагностики, которые пришли от pyright.
//
// Запуск: npm run dev:lsp   (в другом окне)   и   npm run lsp:probe
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const port = Number(process.env.LSP_PORT ?? 3001) || 3001;
const appPort = Number(process.env.PORT ?? 3000) || 3000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-probe-"));
const file = path.join(dir, "exercise.py");
fs.writeFileSync(file, "def transpose(M):\n    return unknown_name(M)\n", "utf8");

// Origin проставлен явно: мост пускает только страницу приложения (см. договор
// о доступе в scripts/lsp-bridge.mts), а у node-клиента своего Origin нет.
const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
  headers: { origin: `http://127.0.0.1:${appPort}` },
});
const send = (message: unknown) => socket.send(JSON.stringify(message));
const timer = setTimeout(() => {
  console.error("Диагностики не пришли за 20 с");
  process.exit(1);
}, 20_000);

socket.on("open", () => {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      processId: process.pid,
      rootUri: `file://${dir}`,
      capabilities: {},
      workspaceFolders: [{ uri: `file://${dir}`, name: "probe" }],
    },
  });
});

socket.on("message", (data) => {
  const message = JSON.parse(String(data));
  if (message.id === 1) {
    send({ jsonrpc: "2.0", method: "initialized", params: {} });
    send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: `file://${file}`,
          languageId: "python",
          version: 1,
          text: fs.readFileSync(file, "utf8"),
        },
      },
    });
  }
  if (message.method === "textDocument/publishDiagnostics") {
    console.log(JSON.stringify(message.params.diagnostics, null, 2));
    clearTimeout(timer);
    socket.close();
    process.exit(message.params.diagnostics.length > 0 ? 0 : 1);
  }
});
