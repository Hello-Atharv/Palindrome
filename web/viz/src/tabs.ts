import { h } from './dom';

export interface TabDef {
  id: string;
  label: string;
  el: HTMLElement;
  /** Shown but not selectable (for features that need something that does not exist yet). */
  disabled?: boolean;
  title?: string;
  /** No button in the tab bar: the pane is reached some other way (the Compare engines button). */
  hidden?: boolean;
}

/** A tab bar plus panes. Only the selected pane is visible; panes keep their DOM and state when hidden. */
export class Tabs {
  readonly bar = h('div', 'tabs');
  readonly body = h('div', 'tab-panes');
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly panes = new Map<string, HTMLElement>();
  private readonly listeners = new Set<(id: string) => void>();
  private current = '';

  constructor(defs: TabDef[], initial = defs.find((d) => !d.disabled)?.id ?? '') {
    this.bar.setAttribute('role', 'tablist');
    for (const d of defs) {
      const b = h('button', 'tab', d.label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      if (d.title) b.title = d.title;
      if (d.disabled) b.disabled = true;
      if (d.hidden) b.hidden = true;
      b.addEventListener('click', () => this.select(d.id));
      this.bar.append(b);
      this.buttons.set(d.id, b);
      d.el.classList.add('tab-pane');
      d.el.setAttribute('role', 'tabpanel');
      this.body.append(d.el);
      this.panes.set(d.id, d.el);
    }
    this.select(initial);
  }

  get active(): string {
    return this.current;
  }

  select(id: string): void {
    const btn = this.buttons.get(id);
    if (!btn || btn.disabled) return;
    this.current = id;
    for (const [k, b] of this.buttons) {
      b.classList.toggle('active', k === id);
      b.setAttribute('aria-selected', String(k === id));
    }
    for (const [k, p] of this.panes) p.hidden = k !== id;
    this.listeners.forEach((fn) => fn(id));
  }

  /** Enable or disable a tab; `title` becomes its tooltip (say why it is disabled). */
  setDisabled(id: string, disabled: boolean, title?: string): void {
    const b = this.buttons.get(id);
    if (!b) return;
    b.disabled = disabled;
    if (title !== undefined) b.title = title;
    if (disabled && this.current === id) this.select([...this.buttons].find(([, x]) => !x.disabled)?.[0] ?? id);
  }

  onChange(fn: (id: string) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
}
