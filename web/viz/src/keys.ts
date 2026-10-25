/**
 * Keyboard -> input events. The tape stores one u32 per event (spec/input_tape.md leaves the encoding open),
 * so the UI uses: low byte = key code, bit 8 (0x100) set = key released.
 *   printable keys: ASCII, upper-cased ('A'..'Z', '0'..'9', ...)   Space 0x20  Enter 0x0D  Escape 0x1B
 *   arrows: Up 0x80, Down 0x81, Left 0x82, Right 0x83
 */

export const KEY_UP_FLAG = 0x100;

const NAMED: Record<string, number> = {
  ArrowUp: 0x80, ArrowDown: 0x81, ArrowLeft: 0x82, ArrowRight: 0x83,
  ' ': 0x20, Enter: 0x0d, Escape: 0x1b, Backspace: 0x08, Tab: 0x09,
};

export function keyCode(key: string): number | null {
  if (key in NAMED) return NAMED[key];
  if (key.length === 1) {
    const c = key.toUpperCase().charCodeAt(0);
    return c < 0x80 ? c : null;
  }
  return null;
}

export function describeKey(value: number): string {
  const code = value & 0xff;
  const name = Object.entries(NAMED).find(([, v]) => v === code)?.[0];
  const label = name === ' ' ? 'Space' : name ?? String.fromCharCode(code);
  return `${label} ${value & KEY_UP_FLAG ? 'up' : 'down'}`;
}

/** Listen on the window; returns a detach function. Ignores typing in form fields and shortcuts. */
export function attachKeys(onKey: (value: number) => void, enabled: () => boolean): () => void {
  const handler = (ev: KeyboardEvent, up: boolean): void => {
    if (!enabled() || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const el = ev.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
    const code = keyCode(ev.key);
    if (code === null) return;
    ev.preventDefault(); // always, auto-repeats too: a held arrow key must not scroll the page
    if (ev.repeat) return; // but only the first press is an input event
    onKey(code | (up ? KEY_UP_FLAG : 0));
  };
  const down = (ev: KeyboardEvent): void => handler(ev, false);
  const up = (ev: KeyboardEvent): void => handler(ev, true);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };
}
