/**
 * Keyboard shortcuts. The transport uses Alt so it never collides with keys sent to the machine (keys.ts ignores Alt
 * combinations): Alt+, back, Alt+. step, Alt+Space run/pause, Alt+0 stop. Ctrl+B shows or hides the editor, as in VS Code.
 */
export interface ShortcutActions {
  step(): void;
  stepBack(): void;
  toggleRun(): void;
  stop(): void;
  toggleSidebar(): void;
}

export function attachShortcuts(a: ShortcutActions): () => void {
  const handler = (ev: KeyboardEvent): void => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'b') {
      ev.preventDefault();
      a.toggleSidebar();
      return;
    }
    if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const act: (() => void) | null =
      ev.key === ',' ? a.stepBack :
      ev.key === '.' ? a.step :
      ev.key === ' ' ? a.toggleRun :
      ev.key === '0' ? a.stop : null;
    if (!act) return;
    ev.preventDefault();
    act();
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
