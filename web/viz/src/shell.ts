import type { Direction, RVM, Status } from '../../../spec/vm_api';
import { buildControls } from './controls';
import { h } from './dom';
import { attachKeys } from './keys';
import { listingPanel } from './panels/listing';
import type { ListingApi } from './panels/listing';
import { memoryPanel } from './panels/memory';
import type { Ctx, Panel } from './panels/panel';
import { registersPanel } from './panels/registers';
import { screenPanel } from './panels/screen';
import { statusPanel } from './panels/status';
import { inspectImage } from './program';
import type { ProgramEntry, ProgramInfo } from './program';
import { Runner } from './runner';
import type { RunMode } from './runner';
import { takeSnapshot } from './snapshot';
import type { Snapshot } from './snapshot';
import { Tabs } from './tabs';

export interface VizOptions {
  /** Sample programs for the picker. The first one is loaded unless `initialProgram` says otherwise. */
  programs?: ProgramEntry[];
  initialProgram?: number;
}

/** One machine under the shell. Every action is applied to all of them, so they share one clock (Compare view). */
export interface Machine {
  label: string;
  vm: RVM;
}

/** Empty containers inside the shell for other tools (the debugger) to fill. */
export interface VizSlots {
  /** Right of the transport buttons. */
  toolbar: HTMLElement;
  /** Full-width strip under the toolbar: put the scrubber timeline here. */
  timeline: HTMLElement;
  /** Bottom of the right-hand column: breakpoints, watch lists, ... */
  side: HTMLElement;
  /** The debugger's left pane (editor, controls, watches). While it has children the built-in controls hide. */
  left: HTMLElement;
  /** Body of the Code view (the editor). */
  code: HTMLElement;
}

export interface UpdateEvent {
  t: number;
  /** Largest t reached on the current branch. */
  maxT: number;
  /** True once a host action discarded part of the timeline since the last load. */
  branch: boolean;
  direction: Direction;
  snap: Snapshot;
  /** Snapshot before the most recent change of t (null right after a load). */
  prev: Snapshot | null;
  status: Status;
}

export interface VizEvents {
  /** After every panel refresh (a step, a run frame, a load, a key press, or `refresh()`). */
  update: UpdateEvent;
  /** After a program was loaded and the machines reset to t = 0. */
  load: ProgramInfo;
  /** Run state changed: which way it is running, or null when paused/stopped. */
  run: { mode: RunMode | null };
}

export type BuiltinControls = 'auto' | 'on' | 'off';

export interface VizHandle {
  readonly root: HTMLElement;
  /** The primary machine (machines[0]). */
  readonly vm: RVM;
  readonly machines: readonly Machine[];
  readonly slots: VizSlots;
  /** Hooks into the code listing: line clicks, breakpoint dots, culprit line. */
  readonly listing: ListingApi;
  readonly program: ProgramInfo | null;
  /** Latest snapshot of the primary machine. */
  readonly snapshot: Snapshot;
  readonly maxT: number;
  readonly branch: boolean;
  on<K extends keyof VizEvents>(event: K, fn: (e: VizEvents[K]) => void): () => void;
  /** Re-read the machines and redraw. Call this after driving a vm directly (runTo, ...). */
  refresh(status?: Status): void;
  step(): Status;
  stepBack(): Status;
  run(mode?: RunMode): void;
  pause(): void;
  reset(): Status;
  loadImage(name: string, image: Uint8Array): Status;
  /** Host actions: apply to every machine, start a new branch (maxT resets), then redraw. Prefer these over calling the vm. */
  pushInput(value: number): Status;
  setDirection(d: Direction): Status;
  /** Call after you did a host action on a vm yourself, so maxT and `branch` stay right. */
  noteHostAction(): void;
  /** 'auto' (default): hide the built-in step/run controls while `slots.left` has children. */
  setBuiltinControls(mode: BuiltinControls): void;
  destroy(): void;
}

type Listeners = { [K in keyof VizEvents]: Set<(e: VizEvents[K]) => void> };

/** Build the visualiser into `root` and drive `vm`. This is the debugger's mount point. */
export function mountViz(root: HTMLElement, vm: RVM, opts: VizOptions = {}): VizHandle {
  const programs = opts.programs ?? [];
  const machines: Machine[] = [{ label: vm.kind, vm }];
  let program: ProgramInfo | null = null;
  let last: Snapshot = takeSnapshot(vm, 'ok');
  let prev: Snapshot | null = null;
  let status: Status = 'ok';
  let maxT = 0;
  let branch = false;
  let refreshQueued = false;
  const listeners: Listeners = { update: new Set(), load: new Set(), run: new Set() };
  const emit = <K extends keyof VizEvents>(k: K, e: VizEvents[K]): void => listeners[k].forEach((fn) => fn(e));
  const primary = (): RVM => machines[0].vm;
  /** Apply an action to every machine; the primary's result is the answer. */
  const all = (fn: (v: RVM) => Status): Status => machines.map((m) => fn(m.vm))[0];

  // ---- panels ----
  const registers = registersPanel();
  const listing = listingPanel();
  const statusP = statusPanel();
  const memory = memoryPanel();
  const screen = screenPanel();
  const panels: Panel[] = [registers, listing, statusP, memory, screen];

  // ---- runner and controls ----
  const runner = new Runner(vm, (s, running) => {
    refresh(s);
    if (!running) {
      controls.setRunning(null);
      emit('run', { mode: null });
    }
  });
  const controls = buildControls(programs, runner.speedIndex, {
    step: () => api.step(),
    stepBack: () => api.stepBack(),
    run: (m) => api.run(m),
    pause: () => api.pause(),
    reset: () => api.reset(),
    setSpeed: (i) => { runner.speedIndex = i; },
    loadSample: (i) => loadSample(i),
    loadFile: (f) => void f.arrayBuffer().then((b) => api.loadImage(f.name, new Uint8Array(b))),
  });

  // ---- DOM ----
  const slots: VizSlots = {
    toolbar: h('div', 'slot slot-toolbar'),
    timeline: h('div', 'slot slot-timeline'),
    side: h('div', 'slot slot-side'),
    left: h('div', 'slot slot-left'),
    code: h('div', 'slot slot-code'),
  };
  for (const [k, e] of Object.entries(slots)) e.dataset.slot = k;

  const header = h('header', 'viz-header');
  const brand = h('div', 'brand');
  brand.append(h('span', 'brand-mark', '⇄'), h('h1', '', 'Reversible machine'), h('span', 'brand-sub', 'every instruction is a bijection'));
  const engine = h('span', 'badge mono', vm.kind);
  header.append(brand, engine, controls.program);

  const bar = h('div', 'viz-bar');
  bar.append(controls.transport, slots.toolbar);

  // right-hand tabs: Memory / Screen / Compare (Compare needs the second engine)
  const rightTabs = new Tabs(
    [
      { id: 'memory', label: 'Memory', el: memory.el },
      { id: 'screen', label: 'Screen', el: screen.el },
      { id: 'compare', label: 'Compare', el: h('div', 'empty', 'Compare needs the reversible engine in the browser (WASM build).'), disabled: true, title: 'available once the WASM build lands' },
    ],
    'screen',
  );
  const right = h('div', 'viz-col');
  right.append(rightTabs.bar, rightTabs.body, slots.side);

  const centre = h('div', 'viz-col');
  centre.append(registers.el, listing.el, statusP.el);

  const debugView = h('div', 'viz-main');
  debugView.append(slots.left, centre, right);

  const codeView = h('div', 'code-view');
  codeView.append(slots.code, h('p', 'empty code-empty', 'The editor appears here when the debugger is mounted.'));

  const views = new Tabs([
    { id: 'debug', label: 'Debug', el: debugView },
    { id: 'code', label: 'Code', el: codeView },
  ]);

  root.classList.add('viz');
  root.replaceChildren(header, bar, slots.timeline, views.bar, views.body);

  // ---- state flow ----
  function refresh(s: Status = 'ok'): void {
    refreshQueued = false;
    status = s;
    const cur = takeSnapshot(primary(), s);
    if (cur.t !== last.t) prev = last;
    last = cur;
    if (cur.t > maxT) maxT = cur.t;
    root.dataset.dir = cur.direction === 1 ? 'fwd' : 'rev';
    root.dataset.status = s;
    const ctx: Ctx = { vm: primary(), snap: cur, prev, program, maxT, branch };
    for (const p of panels) p.update(ctx);
    emit('update', { t: cur.t, maxT, branch, direction: cur.direction, snap: cur, prev, status: s });
  }

  /** Coalesce bursts (key presses) into one redraw per animation frame. */
  function scheduleRefresh(): void {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => refresh(status));
  }

  function hostAction(): void {
    const t = primary().instructionCount;
    if (t < maxT) branch = true; // the future above t is discarded
    maxT = t;
  }

  function loadSample(i: number): void {
    const p = programs[i];
    if (!p) return;
    controls.setProgramIndex(i);
    api.loadImage(p.name, p.load());
  }

  const detachKeys = attachKeys(
    (value) => {
      api.pushInput(value);
      screen.setLastKey(value);
    },
    () => screen.capturing() && views.active === 'debug' && rightTabs.active === 'screen',
  );

  const api: VizHandle = {
    root,
    vm,
    machines,
    slots,
    listing: listing.api,
    get program() { return program; },
    get snapshot() { return last; },
    get maxT() { return maxT; },
    get branch() { return branch; },
    on(event, fn) {
      const set = listeners[event] as Set<unknown>;
      set.add(fn);
      return () => void set.delete(fn);
    },
    refresh,
    step() {
      api.pause();
      const s = all((v) => v.stepForward());
      refresh(s);
      return s;
    },
    stepBack() {
      api.pause();
      const s = all((v) => v.stepBack());
      refresh(s);
      return s;
    },
    run(mode = 'forward') {
      runner.start(mode);
      controls.setRunning(mode);
      emit('run', { mode });
    },
    pause() {
      if (!runner.running) return;
      runner.stop();
      controls.setRunning(null);
      emit('run', { mode: null });
      refresh(status);
    },
    reset() {
      return program ? api.loadImage(program.name, program.image) : 'bad_program';
    },
    loadImage(name, image) {
      runner.stop();
      controls.setRunning(null);
      const s = all((v) => v.loadProgram(image));
      if (s === 'ok') {
        program = inspectImage(name, image);
        prev = null;
        maxT = 0;
        branch = false;
        last = takeSnapshot(primary(), 'ok');
        refresh('ok');
        emit('load', program);
      } else {
        refresh(s);
      }
      return s;
    },
    pushInput(value) {
      const s = all((v) => v.pushInput(value));
      hostAction();
      scheduleRefresh();
      return s;
    },
    setDirection(d) {
      const s = all((v) => v.setDirection(d));
      hostAction();
      refresh(status);
      return s;
    },
    noteHostAction() {
      hostAction();
      refresh(status);
    },
    setBuiltinControls(mode) {
      if (mode === 'auto') delete root.dataset.builtinControls;
      else root.dataset.builtinControls = mode;
    },
    destroy() {
      runner.stop();
      detachKeys();
      listeners.update.clear();
      listeners.load.clear();
      listeners.run.clear();
      root.classList.remove('viz');
      root.replaceChildren();
    },
  };

  if (programs.length) loadSample(Math.min(opts.initialProgram ?? 0, programs.length - 1));
  else refresh();
  return api;
}
