/**
 * Один запрос за JSON, который НИКОГДА не бросает.
 *
 * Панели практики звали `await fetch(...)` и `await response.json()` внутри
 * async-функций, запущенных через `void`: перекомпиляция dev-сервера или
 * страница с HTML-ошибкой вместо JSON давала необработанный reject — на экране
 * при этом не появлялось ничего, а состояние оставалось «в полёте» (кнопка
 * «Прогнать тесты» навсегда заблокирована, панель навсегда на «Открываю
 * упражнение…»). Поэтому обе ошибки — сетевая и «ответ не разобрался» —
 * возвращаются значением, а не исключением.
 *
 * `data` есть и у неудачи: ответ 409 от PUT /exercise несёт актуальное
 * содержимое файла, и вызывающему оно нужно.
 */
export interface JsonSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export interface JsonFailure {
  ok: false;
  status: number;
  /** Готовая строка для показа человеку, по-русски. */
  error: string;
  /** Разобранное тело ответа, если оно было JSON-ом. */
  data: unknown;
}

export type JsonResult<T> = JsonSuccess<T> | JsonFailure;

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<JsonResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    // Сюда попадает и упавший dev-сервер, и прерванный запрос.
    return { ok: false, status: 0, error: `Сервер не ответил: ${(error as Error).message}`, data: null };
  }

  let data: unknown = null;
  let parsed = true;
  try {
    data = await response.json();
  } catch {
    parsed = false;
  }

  if (!response.ok) {
    const fromBody = parsed ? (data as { error?: unknown } | null)?.error : undefined;
    return {
      ok: false,
      status: response.status,
      error: typeof fromBody === "string" ? fromBody : `Сервер ответил ${response.status}`,
      data,
    };
  }

  if (!parsed) {
    return {
      ok: false,
      status: response.status,
      error: "Ответ сервера не разобрался как JSON — похоже, сервер перезапускается",
      data: null,
    };
  }

  return { ok: true, status: response.status, data: data as T };
}
