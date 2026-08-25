/** Добавляет кнопку в слот действий шапки, сохраняя старые страницы без него. */
export function appendAuthButton(document: Document, button: HTMLButtonElement): void {
  const header = document.querySelector<HTMLElement>("header");
  if (!header) return;

  const actions = header.querySelector<HTMLElement>("[data-header-actions]");
  (actions ?? header).append(button);
}
