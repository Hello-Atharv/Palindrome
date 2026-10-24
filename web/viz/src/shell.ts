import type { RVM, Status } from '../../../spec/vm_api';
import { buildControls } from './controls';
import { h } from './dom';
import { attachKeys, describeKey } from './keys';
import { cpuPanel } from './panels/cpu';
import { framebufferPanel } from './panels/framebuffer';
import { memoryPanel } from './panels/memory';
import type { Ctx } from './panels/panel';
import { registersPanel } from './panels/registers';
import { statusPanel } from './panels/status';
import { inspectImage } from './program';
import type { ProgramEntry, ProgramInfo } from './program';
import { Runner } from './runner';
import type { RunMode } from './runner';
import { takeSnapshot } from './snapshot';
import type { Snapshot } from './snapshot';

export interface VizOptions {
  /** Sample programs for the picker. The first one is loaded unless `initialProgram` says otherwise. */
  programs?: ProgramEntry[];
  initialProgram?: number;
  /** Send keyboard events to the machine with pushInput (default true; the user can toggle it). */
  captureKeys?: boolean;
}

/** Empty containers inside the shell for other tools (the debugger) to fill. */
export interface VizSlots {
  /** Right of the transport buttons. */
  toolbar: HTMLElement;
  /** Full-width strip under the toolbar: put the scrubber timeline here. */
  timeline: HTMLElement;
  /** Bottom of the right-hand column: breakpoints, watch lists, ... */
  side: HTMLElement;
}

export interface UpdateEvent {
  snap: Snapshot;
  /** Snapshot before the most recent change of t (null right after a load). */
  prev: Snapshot | null;
  status: Status;
}

export interface VizEvents {
  /** After every panel refresh (a step, a run frame, a load, a key press, or `refresh()`). */
  update: UpdateEvent;
  /** After a program was loaded and the VM reset to t = 0. */
  load: ProgramInfo;
  /** Run state changed: which way it is running, or null when paused/stopped. */
  run: { mode: RunMode | null };
}

export interface VizHandle {
  readonly root: HTMLElement;
  readonly vm: RVM;
  readonly slots: VizSlots;
  readonly program: ProgramInfo | null;
  readonly snapshot: Snapshot;
  on<K extends keyof VizEvents>(event: K, fn: (e: VizEvents[K]) => void): () => void;
  /** Re-read the VM and redraw. Call this after driving `vm` directly (runTo, setDirection, ...). */
  refresh(status?: Status): void;
  step(): Status;
  stepBack(): Status;
  run(mode?: RunMode): void;
  pause(): void;
  reset(): Status;
  loadImage(name: string, image: Uint8Array): Status;
  destroy(): void;
}

type Listeners = { [K in keyof VizEvents]: Set<(e: VizEvents[K]) => void> };

/** Build the visualiser into `root` and drive `vm`. This is the debugger's mount point. */
export function mountViz(root: HTMLElement, vm: RVM, opts: VizOptions = {}): VizHandle {
  const programs = opts.programs ?? [];
  let capture = opts.captureKeys ?? true;
  let program: ProgramInfo | null = null;
  let last: Snapshot = takeSnapshot(vm, 'ok');
  let prev: Snapshot | null = null;
  let status: Status = 'ok';
  const listeners: Listeners = { update: new Set(), load: new Set(), run: new Set() };
  const emit = <K extends keyof VizEvents>(k: K, e: VizEvents[K]): void => listeners[k].forEach((fn) => fn(e));

  // ---- panels ----
  const panels = [framebufferPanel(), statusPanel(), registersPanel(), cpuPanel(), memoryPanel()];
  const [display, statusP, registers, cpu, memory] = panels;

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
    setCapture: (on) => { capture = on; },
  });

  // ---- DOM ----
  const slots: VizSlots = {
    toolbar: h('div', 'slot slot-toolbar'),
    timeline: h('div', 'slot slot-timeline'),
    side: h('div', 'slot slot-side'),
  };
  slots.toolbar.dataset.slot = 'toolbar';
  slots.timeline.dataset.slot = 'timeline';
  slots.side.dataset.slot = 'side';

  const header = h('header', 'viz-header');
  const brand = h('div', 'brand');
  brand.append(h('span', 'brand-mark', '⇄'), h('h1', '', 'Reversible machine'), h('span', 'brand-sub', 'every instruction is a bijection'));
  const engine = h('span', 'badge mono', vm.kind);
  header.append(brand, engine, controls.program);

  const bar = h('div', 'viz-bar');
  bar.append(controls.transport, slots.toolbar);

  const main = h('main', 'viz-main');
  const col = (...els: HTMLElement[]): HTMLElement => {
    const c = h('div', 'viz-col');
    c.append(...els);
    return c;
  };
  main.append(col(display.el, statusP.el), col(registers.el, cpu.el), col(memory.el, slots.side));

  root.classList.add('viz');
  root.replaceChildren(header, bar, slots.timeline, main);

  // ---- state flow ----
  function refresh(s: Status = 'ok'): void {
    status = s;
    const cur = takeSnapshot(vm, s);
    if (cur.t !== last.t) prev = last;
    last = cur;
    root.dataset.dir = cur.direction === 1 ? 'fwd' : 'rev';
    root.dataset.status = s;
    const ctx: Ctx = { vm, snap: cur, prev, program };
    for (const p of panels) p.update(ctx);
    emit('update', { snap: cur, prev, status: s });
  }

  function loadSample(i: number): void {
    const p = programs[i];
    if (!p) return;
    controls.setProgramIndex(i);
    api.loadImage(p.name, p.load());
  }

  const detachKeys = attachKeys(
    (value) => {
      vm.pushInput(value);
      controls.setLastKey(describeKey(value));
      refresh(status);
    },
    () => capture,
  );

  const api: VizHandle = {
    root,
    vm,
    slots,
    get program() { return program; },
    get snapshot() { return last; },
    on(event, fn) {
      const set = listeners[event] as Set<unknown>;
      set.add(fn);
      return () => void set.delete(fn);
    },
    refresh,
    step() {
      api.pause();
      const s = vm.stepForward();
      refresh(s);
      return s;
    },
    stepBack() {
      api.pause();
      const s = vm.stepBack();
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
      const s = vm.loadProgram(image);
      if (s === 'ok') {
        program = inspectImage(name, image);
        prev = null;
        last = takeSnapshot(vm, 'ok');
        refresh('ok');
        emit('load', program);
      } else {
        refresh(s);
      }
      return s;
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
