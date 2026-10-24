/** Tiny DOM helpers. All text goes through textContent, never innerHTML. */

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export const hex = (v: number, width = 8): string => (v >>> 0).toString(16).padStart(width, '0');

/** Re-trigger a CSS animation class on an element. */
export function flash(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth; // restart the animation
  e.classList.add(cls);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}
