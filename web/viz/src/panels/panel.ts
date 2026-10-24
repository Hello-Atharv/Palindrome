import type { RVM } from '../../../../spec/vm_api';
import { h } from '../dom';
import type { ProgramInfo } from '../program';
import type { Snapshot } from '../snapshot';

/** What a panel gets on every update. `prev` is the snapshot before the most recent change of t. */
export interface Ctx {
  vm: RVM;
  snap: Snapshot;
  prev: Snapshot | null;
  program: ProgramInfo | null;
  /** Largest t reached on the current branch (reset by host actions and loads). */
  maxT: number;
  /** True once a host action discarded part of the timeline (typed or flipped direction after scrubbing back). */
  branch: boolean;
}

export interface Panel {
  el: HTMLElement;
  update(ctx: Ctx): void;
}

/** Common chrome: a titled box. Returns the box and its body. */
export function frame(title: string, cls = ''): { el: HTMLElement; body: HTMLElement; head: HTMLElement } {
  const el = h('section', `panel ${cls}`.trim());
  const head = h('header', 'panel-head');
  head.append(h('h2', 'panel-title', title));
  const body = h('div', 'panel-body');
  el.append(head, body);
  return { el, body, head };
}
