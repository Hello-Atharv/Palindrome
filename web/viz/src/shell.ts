import type { CreateVm, Direction, RVM, Status, VmKind } from '../../../spec/vm_api';
import { formatDiagnostics } from './assembler';
import type { AssembleFn, AsmOutcome } from './assembler';
import { FRAME_ADDR } from './constants';
import { buildEngineSwitch, buildProgramBar, buildTransport } from './controls';
import { h } from './dom';
import { attachKeys } from './keys';
import type { Machine } from './machines';
import { bannersPanel } from './panels/banners';
import { codePanel } from './panels/code';
import { comparePanel } from './panels/compare';
import { listingPanel } from './panels/listing';
import type { ListingApi } from './panels/listing';
import { memoryPanel } from './panels/memory';
import type { Ctx, Panel } from './panels/panel';
import { learnPanel } from './panels/learn';
import { registersPanel } from './panels/registers';
import { screenPanel } from './panels/screen';
import { timelinePanel } from './panels/timeline';
import { trackerPanel } from './panels/tracker';
import { inspectImage, learnVerdict } from './program';
import type { ProgramEntry, ProgramInfo } from './program';
import { LEARN_SPEED, Runner, SPEEDS } from './runner';
import type { RunMode } from './runner';
import { attachShortcuts } from './shortcuts';
import { takeSnapshot } from './snapshot';
import type { Snapshot } from './snapshot';
import { Tabs } from './tabs';

export type { Machine } from './machines';

/** Above this many steps per second the page switches from flashes to a heat map. */
const FLASH_MAX_RATE = 20;
/** A tape file with no events: how the shell clears the VM's input tape on every (re)load. */
const EMPTY_TAPE = new Uint8Array([0x52, 0x56, 0x4d, 0x54, 0, 0, 0, 0]);

export interface VizOptions {
  /** Sample programs for the picker. The first one is loaded unless `initialProgram` says otherwise. */
  programs?: ProgramEntry[];
  initialProgram?: number;
  /** Creates a VM of a kind. With it, the engine switch and the Compare view can build engines on demand. */
  createVm?: CreateVm;
  /** The kinds `createVm` can make (default: just the kind of the VM passed to mountViz). */
  engines?: readonly VmKind[];
  /** The assembler hook (asm/src/index.ts `assemble`, adapted). Enables the Code view's built-in editor. */
  assemble?: AssembleFn;
}

/** Empty containers inside the shell for other tools (the debugger) to fill. */
export interface VizSlots {
  /** Right of the timeline's transport buttons (inside the timeline hero). */
  toolbar: HTMLElement;
  /** Full-width strip above the timeline hero. */
  timeline: HTMLElement;
  /** Bottom of the right-hand column: breakpoint list, watches. */
  side: HTMLElement;
  /** The debugger's left pane (editor, controls, watches). While it has children the built-in controls hide. */
  left: HTMLElement;
  /** Body of the Code view (the editor). While it has children the built-in editor hides. */
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
  /** The engine switch or Compare changed the machines list. The primary `vm` may be a different object now. */
  engine: { engine: VmKind; compare: boolean };
}

export type BuiltinControls = 'auto' | 'on' | 'off';

/** The tape strip in the timeline hero. */
export interface TimelineApi {
  /**
   * Called with the target t while the user drags on the strip. If nobody is listening the shell does a plain
   * throttled `runTo` itself (a fallback); a listener (the debugger) takes over completely and must move the machines.
   */
  onSeek(fn: (t: number) => void): () => void;
}

export interface VizHandle {
  readonly root: HTMLElement;
  /** The primary machine (machines[0]). It changes when the engine switch builds a new one: listen to 'engine'. */
  readonly vm: RVM;
  readonly machines: readonly Machine[];
  readonly slots: VizSlots;
  /** Hooks into the code listing: line clicks, breakpoint dots, culprit line. */
  readonly listing: ListingApi;
  readonly timeline: TimelineApi;
  readonly program: ProgramInfo | null;
  /** Latest snapshot of the primary machine. */
  readonly snapshot: Snapshot;
  readonly maxT: number;
  readonly branch: boolean;
  /** The engines this page can create, and whether two are running side by side. */
  readonly engines: readonly VmKind[];
  readonly compare: boolean;
  on<K extends keyof VizEvents>(event: K, fn: (e: VizEvents[K]) => void): () => void;
  /** Re-read the machines and redraw. Call this after driving a vm directly (runTo, ...). */
  refresh(status?: Status): void;
  step(): Status;
  stepBack(): Status;
  run(mode?: RunMode): void;
  pause(): void;
  reset(): Status;
  /** Load a .rvm image into every machine (t = 0, input tape cleared). `source` is shown in the Code view. */
  loadImage(name: string, image: Uint8Array, source?: string): Status;
  /** Assemble `source` with the assembler hook and, if it assembled, load it. */
  assembleAndLoad(source: string, name?: string): AsmOutcome;
  /** Host actions: apply to every machine, start a new branch (maxT resets), then redraw. Prefer these over calling the vm. */
  pushInput(value: number): Status;
  setDirection(d: Direction): Status;
  /** Call after you did a host action on a vm yourself, so maxT and `branch` stay right (engine switches cannot replay it). */
  noteHostAction(): void;
  /** Switch the primary engine, replaying the run (program, inputs, direction flips, t) on a fresh VM. */
  setEngine(kind: VmKind): Promise<Status>;
  /** Run the other engine alongside, in lockstep, with a state-match check. */
  setCompare(on: boolean): Promise<Status>;
  /** 'auto' (default): hide the built-in transport while `slots.left` has children. */
  setBuiltinControls(mode: BuiltinControls): void;
  destroy(): void;
}

type Listeners = { [K in keyof VizEvents]: Set<(e: VizEvents[K]) => void> };

/** A host action on the current branch, kept so another engine can replay the run. */
type HostRec = { t: number; kind: 'in' | 'dir'; value: number };

const otherKind = (k: VmKind): VmKind => (k === 'logging' ? 'reversible' : 'logging');
const release = (m: Machine): void => (m.vm as { destroy?: () => void }).destroy?.();

/** Build the visualiser into `root` and drive `vm`. This is the debugger's mount point. */
export function mountViz(root: HTMLElement, vm: RVM, opts: VizOptions = {}): VizHandle {
  const programs = opts.programs ?? [];
  const engines: readonly VmKind[] = opts.engines ?? [vm.kind];
  const createVm = opts.createVm;
  const machines: Machine[] = [{ label: vm.kind, vm }];
  let program: ProgramInfo | null = null;
  let last: Snapshot = takeSnapshot(vm, 'ok');
  let prev: Snapshot | null = null;
  let status: Status = 'ok';
  let notice: string | null = null;
  let maxT = 0;
  let branch = false;
  let branchAt: number | null = null;
  let lostTo: number | null = null;
  let hostLog: HostRec[] = [];
  let runState: 'fwd' | 'back' | 'paused' = 'paused';
  let rate: number | null = null;
  let rateT = 0;
  let rateMs = 0;
  let refreshQueued = false;
  let seekQueued: number | null = null;
  const listeners: Listeners = { update: new Set(), load: new Set(), run: new Set(), engine: new Set() };
  const seekListeners = new Set<(t: number) => void>();
  const emit = <K extends keyof VizEvents>(k: K, e: VizEvents[K]): void => listeners[k].forEach((fn) => fn(e));
  const primary = (): RVM => machines[0].vm;
  /** Apply an action to every machine; the primary's result is the answer. */
  const all = (fn: (v: RVM) => Status): Status => machines.map((m) => fn(m.vm))[0];

  // ---- panels ----
  const registers = registersPanel();
  const listing = listingPanel();
  const memory = memoryPanel();
  const screen = screenPanel();
  const tracker = trackerPanel();
  const banners = bannersPanel();
  const compare = comparePanel({
    onToggle: (on) => void api.setCompare(on),
    onMismatch: () => api.pause(),
  });
  const canCompare = !!createVm && engines.includes('logging') && engines.includes('reversible');
  compare.setAvailable(canCompare, 'Comparing needs both engines: it needs the WebAssembly build (web/wasm)');

  // ---- runner and transport ----
  const runner = new Runner(() => machines, (s, running) => {
    refresh(s);
    if (!running) setRun('paused');
  });
  const transport = buildTransport(
    {
      step: () => api.step(),
      stepBack: () => api.stepBack(),
      run: (m) => api.run(m),
      pause: () => api.pause(),
      stop: () => void api.reset(),
      setSpeed: (i) => { runner.speedIndex = i; updateMode(); },
      setDirection: (d) => void api.setDirection(d),
    },
    runner.speedIndex,
  );
  const timeline = timelinePanel(transport, (t) => seek(t));
  const code = opts.assemble ? codePanel(programs, (src, name) => api.assembleAndLoad(src, name), (i) => loadSample(i)) : null;
  const learn = learnPanel();
  const panels: Panel[] = [registers, listing, memory, screen, tracker, banners, timeline, compare, learn, ...(code ? [code] : [])];

  const programBar = buildProgramBar(
    programs,
    (i) => loadSample(i),
    (f) => void f.arrayBuffer().then((b) => api.loadImage(f.name, new Uint8Array(b))),
  );

  // ---- DOM ----
  const slots: VizSlots = {
    toolbar: h('div', 'slot slot-toolbar'),
    timeline: h('div', 'slot slot-timeline'),
    side: h('div', 'slot slot-side'),
    left: h('div', 'slot slot-left'),
    code: h('div', 'slot slot-code'),
  };
  for (const [k, e] of Object.entries(slots)) e.dataset.slot = k;
  timeline.el.querySelector('.timeline-top')!.insertBefore(slots.toolbar, transport.el);

  const header = h('header', 'viz-header');
  const brand = h('div', 'brand');
  brand.append(h('span', 'brand-mark', '⇄'), h('h1', '', 'Reversible machine'), h('span', 'brand-sub', 'time runs both ways'));
  const engineBadge = h('span', 'badge engine-badge');
  const engineSwitch = buildEngineSwitch(engines, vm.kind, (k) => void api.setEngine(k));
  const branchBadge = h('span', 'badge branch-badge', '⑂ New timeline');
  branchBadge.title = 'A key press or direction flip while scrubbed back discarded the rest of the old timeline';
  branchBadge.hidden = true;
  header.append(brand, branchBadge, engineBadge, engineSwitch.el, programBar.el);

  // right-hand tabs: Screen / Memory / Compare
  const rightTabs = new Tabs(
    [
      { id: 'screen', label: 'Screen', el: screen.el },
      { id: 'memory', label: 'Memory', el: memory.el },
      { id: 'compare', label: 'Compare', el: compare.el, disabled: !canCompare, title: canCompare ? 'Run both engines side by side' : 'Needs both engines: the WebAssembly build (web/wasm)' },
    ],
    'screen',
  );
  const right = h('div', 'viz-col');
  right.append(rightTabs.bar, rightTabs.body, tracker.el, slots.side);
  rightTabs.body.classList.add('grow');

  const centre = h('div', 'viz-col');
  centre.append(registers.el, listing.el);

  const debugView = h('div', 'viz-main');
  debugView.append(slots.left, centre, right);

  const codeView = h('div', 'code-view');
  codeView.append(slots.code);
  if (code) codeView.append(code.el);
  else codeView.append(h('p', 'empty code-empty', 'The editor appears here when the debugger is mounted.'));

  const views = new Tabs([
    { id: 'debug', label: 'Debug', el: debugView },
    { id: 'learn', label: 'Learn', el: learn.el, disabled: true, title: 'Load a simple program to watch the datapath' },
    { id: 'code', label: 'Code', el: codeView },
  ]);
  header.append(views.bar);
  views.body.classList.add('viz-body');
  views.onChange((id) => {
    // watching data move needs a slow run: bring a fast speed down when the Learn view opens
    if (id === 'learn' && runner.speedIndex > LEARN_SPEED) {
      runner.speedIndex = LEARN_SPEED;
      transport.setSpeedIndex(LEARN_SPEED);
      updateMode();
    }
    refresh(status);
  });

  root.classList.add('viz');
  root.replaceChildren(header, banners.el, slots.timeline, views.body, timeline.el);

  // ---- state flow ----
  function updateMode(): void {
    const fast = runState !== 'paused' && SPEEDS[runner.speedIndex] > FLASH_MAX_RATE;
    root.dataset.mode = fast ? 'heat' : 'flash';
  }

  function setRun(next: 'fwd' | 'back' | 'paused'): void {
    runState = next;
    root.dataset.run = next;
    transport.setRun(next === 'fwd' ? 'forward' : next === 'back' ? 'back' : null);
    rate = null;
    rateT = primary().instructionCount;
    rateMs = performance.now();
    updateMode();
    emit('run', { mode: next === 'fwd' ? 'forward' : next === 'back' ? 'back' : null });
  }

  function measureRate(t: number): void {
    if (runState === 'paused') return;
    const now = performance.now();
    if (now - rateMs >= 250) {
      rate = (Math.abs(t - rateT) / (now - rateMs)) * 1000;
      rateT = t;
      rateMs = now;
    }
  }

  function refresh(s: Status = 'ok'): void {
    refreshQueued = false;
    status = s;
    const vmNow = primary();
    const cur = takeSnapshot(vmNow, s);
    if (cur.t !== last.t) {
      prev = last;
      root.dataset.motion = cur.t < last.t ? 'back' : 'fwd';
    }
    last = cur;
    if (cur.t > maxT) maxT = cur.t;
    measureRate(cur.t);
    root.dataset.dir = cur.direction === 1 ? 'fwd' : 'rev';
    root.dataset.status = s;
    root.dataset.engine = vmNow.kind;
    branchBadge.hidden = !branch;
    engineBadge.textContent = vmNow.kind === 'logging' ? 'Diary: keeps history' : 'Reversible: no history';
    engineBadge.dataset.engine = vmNow.kind;
    engineSwitch.setKind(vmNow.kind);
    transport.setDirection(cur.direction);
    const frame = vmNow.memory(FRAME_ADDR, 1)[0];
    const ctx: Ctx = { vm: vmNow, snap: cur, prev, program, maxT, branch, branchAt, lostTo, run: runState, rate, frame, machines, notice, view: views.active, stepHz: SPEEDS[runner.speedIndex], heat: root.dataset.mode === 'heat' };
    for (const p of panels) p.update(ctx);
    emit('update', { t: cur.t, maxT, branch, direction: cur.direction, snap: cur, prev, status: s });
  }

  /** Coalesce bursts (key presses) into one redraw per animation frame. */
  function scheduleRefresh(): void {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => refresh(status));
  }

  /** A host action at t discards the future above t: that is a fork if there was a future. */
  function hostAction(rec?: Omit<HostRec, 't'>): void {
    const t = primary().instructionCount;
    if (t < maxT) {
      branch = true;
      branchAt = t;
      lostTo = maxT;
    }
    maxT = t;
    hostLog = hostLog.filter((a) => a.t <= t);
    if (rec) hostLog.push({ t, ...rec });
  }

  /** Bring a fresh VM to the state of the current run: same program, same inputs and flips at the same t, same t. */
  function replay(v: RVM, targetT: number): void {
    if (!program) return;
    v.loadProgram(program.image);
    v.setInputTape(EMPTY_TAPE);
    for (const a of hostLog) {
      v.runTo(a.t);
      if (v.instructionCount !== a.t) break;
      if (a.kind === 'in') v.pushInput(a.value);
      else v.setDirection(a.value === -1 ? -1 : 1);
    }
    v.runTo(targetT);
  }

  async function makeMachine(kind: VmKind, targetT: number): Promise<Machine> {
    const v = await createVm!(kind);
    replay(v, targetT);
    return { label: kind, vm: v };
  }

  function seek(t: number): void {
    if (seekListeners.size) {
      seekListeners.forEach((fn) => fn(t));
      return;
    }
    const first = seekQueued === null;
    seekQueued = Math.min(t, maxT); // fallback: a plain runTo, throttled to one per frame
    if (!first) return;
    requestAnimationFrame(() => {
      const target = seekQueued!;
      seekQueued = null;
      api.pause();
      refresh(all((v) => v.runTo(target)));
    });
  }

  function loadSample(i: number): void {
    const p = programs[i];
    if (!p) return;
    programBar.setIndex(i);
    try {
      api.loadImage(p.name, p.load(), p.source);
    } catch (e) {
      notice = e instanceof Error ? e.message : String(e);
      refresh('bad_program');
    }
  }

  const detachKeys = attachKeys(
    (value) => {
      api.pushInput(value);
      screen.setLastKey(value);
    },
    () => screen.capturing() && views.active === 'debug' && rightTabs.active === 'screen',
  );
  const detachShortcuts = attachShortcuts({
    step: () => void api.step(),
    stepBack: () => void api.stepBack(),
    toggleRun: () => (runState === 'fwd' ? api.pause() : api.run('forward')),
    stop: () => void api.reset(),
  });

  const api: VizHandle = {
    root,
    get vm() { return primary(); },
    machines,
    slots,
    engines,
    listing: listing.api,
    timeline: {
      onSeek(fn) {
        seekListeners.add(fn);
        return () => void seekListeners.delete(fn);
      },
    },
    get program() { return program; },
    get snapshot() { return last; },
    get maxT() { return maxT; },
    get branch() { return branch; },
    get compare() { return machines.length > 1; },
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
      setRun(mode === 'forward' ? 'fwd' : 'back');
    },
    pause() {
      if (!runner.running) return;
      runner.stop();
      setRun('paused');
      refresh(status);
    },
    reset() {
      return program ? api.loadImage(program.name, program.image, program.source) : 'bad_program';
    },
    loadImage(name, image, source) {
      runner.stop();
      if (runState !== 'paused') setRun('paused');
      const s = all((v) => v.loadProgram(image));
      if (s === 'ok') {
        all((v) => v.setInputTape(EMPTY_TAPE)); // every run starts with no inputs
        program = inspectImage(name, image, source);
        if (source !== undefined && opts.assemble) {
          program.listing = opts.assemble(source, name).listing.map((r) => ({ addr: r.addr, text: r.text }));
        }
        const verdict = learnVerdict(program);
        views.setDisabled('learn', !verdict.ok, verdict.ok ? 'Watch the datapath: registers, ALU, memory and the bus' : verdict.why);
        programBar.setIndex(programs.findIndex((p) => p.name === name)); // -1 (blank) for a file or edited source
        notice = null;
        hostLog = [];
        prev = null;
        maxT = 0;
        branch = false;
        branchAt = null;
        lostTo = null;
        last = takeSnapshot(primary(), 'ok');
        root.dataset.motion = 'fwd';
        refresh('ok');
        emit('load', program);
      } else {
        notice = primary().lastError;
        refresh(s);
      }
      return s;
    },
    assembleAndLoad(source, name = 'edited') {
      if (!opts.assemble) {
        return { ok: false, diagnostics: [{ severity: 'error', line: 0, message: 'no assembler hook was given to mountViz' }], listing: [] };
      }
      const out = opts.assemble(source, name);
      if (out.ok && out.image) api.loadImage(name, out.image, source);
      else notice = formatDiagnostics(name, out.diagnostics);
      return out;
    },
    pushInput(value) {
      const s = all((v) => v.pushInput(value));
      hostAction({ kind: 'in', value });
      scheduleRefresh();
      return s;
    },
    setDirection(d) {
      const s = all((v) => v.setDirection(d));
      hostAction({ kind: 'dir', value: d });
      refresh(status);
      return s;
    },
    noteHostAction() {
      hostAction();
      refresh(status);
    },
    async setEngine(kind) {
      if (!createVm || !engines.includes(kind)) return 'bad_arg';
      if (primary().kind === kind) return 'ok';
      api.pause();
      const t = primary().instructionCount;
      const kinds: VmKind[] = machines.length > 1 ? [kind, otherKind(kind)] : [kind];
      const fresh = await Promise.all(kinds.map((k) => makeMachine(k, t)));
      machines.splice(0, machines.length, ...fresh).forEach(release);
      refresh(status);
      emit('engine', { engine: kind, compare: machines.length > 1 });
      return 'ok';
    },
    async setCompare(on) {
      if (on === machines.length > 1) return 'ok';
      if (on) {
        if (!canCompare) return 'bad_arg';
        api.pause();
        machines.push(await makeMachine(otherKind(primary().kind), primary().instructionCount));
      } else {
        api.pause();
        machines.splice(1).forEach(release);
      }
      refresh(status);
      emit('engine', { engine: primary().kind, compare: machines.length > 1 });
      return 'ok';
    },
    setBuiltinControls(mode) {
      if (mode === 'auto') delete root.dataset.builtinControls;
      else root.dataset.builtinControls = mode;
    },
    destroy() {
      runner.stop();
      detachKeys();
      detachShortcuts();
      for (const set of Object.values(listeners)) (set as Set<unknown>).clear();
      root.classList.remove('viz');
      root.replaceChildren();
    },
  };

  root.dataset.run = 'paused';
  root.dataset.motion = 'fwd';
  updateMode();
  if (programs.length) loadSample(Math.min(opts.initialProgram ?? 0, programs.length - 1));
  else refresh();
  return api;
}
