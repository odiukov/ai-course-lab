// Браузерный клиент JSON-RPC для моста pyright (Task 11, scripts/lsp-bridge.mts).
// Мост уже занимается кадрированием Content-Length — здесь по сокету летают
// обычные JSON-объекты, один на сообщение.
//
// Фабрика сокета — параметр конструктора, а не `new WebSocket` внутри: без
// этого клиент нельзя проверить без браузера, а именно в парности
// «запрос — ответ» и в очереди до открытия соединения живут все интересные
// ошибки.
export interface LspSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, handler: (event: { data?: unknown }) => void): void;
}

export type SocketFactory = (url: string) => LspSocket;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

const defaultFactory: SocketFactory = (url) => new WebSocket(url) as unknown as LspSocket;

export class LspClient {
  private socket: LspSocket;
  private open = false;
  private queue: string[] = [];
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private diagnosticsHandlers: ((params: { uri: string; diagnostics: unknown[] }) => void)[] = [];
  private timeoutMs: number;
  private disposed = false;
  // Соединения больше нет. В отличие от disposed это не наше решение, а факт:
  // мост умер или сокет упал. Без такого флага после смерти моста каждое
  // нажатие клавиши складывало полную копию документа в очередь, которой
  // некуда деться, а каждый hover и автокомплит молча выжидал свои 15 секунд
  // таймаута, прежде чем отвалиться.
  private closed = false;
  private closeHandlers: ((reason: string) => void)[] = [];

  constructor(options: { url: string; factory?: SocketFactory; timeoutMs?: number }) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.socket = (options.factory ?? defaultFactory)(options.url);

    this.socket.addEventListener("open", () => {
      this.open = true;
      for (const message of this.queue) this.socket.send(message);
      this.queue = [];
    });
    this.socket.addEventListener("message", (event) => this.receive(event.data));
    this.socket.addEventListener("close", () => {
      this.markClosed("Соединение с pyright закрыто");
    });
  }

  onDiagnostics(handler: (params: { uri: string; diagnostics: unknown[] }) => void): void {
    this.diagnosticsHandlers.push(handler);
  }

  /**
   * Зовётся один раз, когда соединение пропало не по нашей воле. Редактор по
   * этому событию говорит учащемуся, что Pyright ушёл: иначе пропажа типов и
   * автокомплита выглядит как «просто перестало работать», а плашка здоровья
   * спрашивает мост всего один раз при монтировании.
   */
  onClose(handler: (reason: string) => void): void {
    this.closeHandlers.push(handler);
  }

  /** Соединения нет: ни отправлять, ни ждать ответа больше нет смысла. */
  get isClosed(): boolean {
    return this.closed || this.disposed;
  }

  async start(options: { rootUri: string; folderName: string }): Promise<void> {
    await this.request("initialize", {
      processId: null,
      rootUri: options.rootUri,
      workspaceFolders: [{ uri: options.rootUri, name: options.folderName }],
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          publishDiagnostics: {},
          hover: { contentFormat: ["markdown", "plaintext"] },
          completion: { completionItem: { snippetSupport: false } },
          signatureHelp: {},
        },
      },
    });
    this.notify("initialized", {});
  }

  didOpen(uri: string, text: string, version: number): void {
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "python", version, text },
    });
  }

  // Полная синхронизация текста, а не инкрементальная: файл упражнения — сотня
  // строк, экономить на диффах нечего, а инкрементальный протокол это ещё один
  // источник расхождения между тем, что видит редактор, и тем, что видит Pyright.
  didChange(uri: string, text: string, version: number): void {
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  request<T>(method: string, params: unknown): Promise<T> {
    // Отказ сразу, а не через 15 секунд таймаута: отвечать на этот запрос
    // некому, и провайдер Monaco должен узнать об этом немедленно.
    if (this.isClosed) return Promise.reject(new Error("Клиент pyright уже закрыт"));
    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`pyright не ответил на ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.open = false;
    this.queue = [];
    this.failAll("Клиент pyright закрыт");
    this.socket.close();
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  // Единственное место, где сообщение либо уходит в сокет, либо ждёт своего
  // открытия в очереди, либо тихо теряется — эта развилка не должна
  // повторяться где-то ещё.
  private send(message: unknown): void {
    // Закрытому клиенту некому отдавать сообщения — копить их в очереди
    // означало бы просто растить память без всякого получателя. Очередь имеет
    // смысл ровно в одном состоянии: сокет ещё открывается.
    if (this.isClosed) return;

    const text = JSON.stringify(message);
    if (!this.open) {
      this.queue.push(text);
      return;
    }

    try {
      this.socket.send(text);
    } catch {
      // Настоящий WebSocket синхронно бросает InvalidStateError, если сокет
      // уже мёртв, а мы об этом ещё не узнали через событие close — редактор
      // не должен падать от нажатия клавиши. Считаем это тем же обрывом.
      this.markClosed("Соединение с pyright закрыто");
    }
  }

  // Единственный переход в «соединения больше нет»: гасит очередь (её теперь
  // никто не отправит), отклоняет всё ожидающее и один раз сообщает наверх.
  private markClosed(reason: string): void {
    this.open = false;
    this.queue = [];
    const first = !this.closed;
    this.closed = true;
    this.failAll(reason);
    if (first && !this.disposed) {
      for (const handler of this.closeHandlers) handler(reason);
    }
  }

  private receive(data: unknown): void {
    let message: { id?: number; method?: string; result?: unknown; error?: { message?: string }; params?: unknown };
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as { uri: string; diagnostics: unknown[] } | undefined;
      if (!params) return;
      for (const handler of this.diagnosticsHandlers) handler(params);
      return;
    }

    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message ?? "ошибка pyright"));
    else pending.resolve(message.result);
  }

  private failAll(reason: string): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
