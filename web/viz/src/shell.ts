import type { CreateVm, Direction, RVM, Status, VmKind } from '../../../spec/vm_api';
import { formatDiagnostics } from './assembler';
import type { AssembleFn, AsmOutcome } from './assembler';
import { FrameTracker } from '../../wasm/src/frames';
import { FRAME_ADDR } from './constants';
import { ENGINE_COLOUR } from './engineColour';
import { buildEngineSwitch, buildProgramBar, buildProgramSelect, buildTransport, buildVariantSwitch } from './controls';
import type { PaceChoice } from './controls';
import { h } from './dom';
import { attachKeys } from './keys';
import type { Machine } from './machines';
import { bannersPanel } from './panels/banners';
import { comparePanel } from './panels/compare';
import { editorPanel } from './panels/editor';
import { gamePanel } from './panels/game';
import type { ListingApi } from './panels/editor';
import { consolePanel } from './panels/console';
import type { Ctx, Panel } from './panels/panel';
import { screenPanel } from './panels/screen';
import { timeBarPanel, timelinePanel } from './panels/timeline';
import { capacityFor } from './panels/timebar';
import { numberInputPanel } from './panels/numberinput';
import { visualisePanel } from './panels/visualise';
import { inspectImage, learnVerdict } from './program';
import type { ProgramEntry, ProgramInfo } from './program';
import { icon } from './icons';
import { DEFAULT_SPEED, LEARN_SPEED, Runner, SPEEDS } from './runner';
import type { RunMode } from './runner';
import { attachShortcuts } from './shortcuts';
import { takeSnapshot } from './snapshot';
import type { Snapshot } from './snapshot';
import { Tabs } from './tabs';
import { measureTracks } from './track';

export type { Machine } from './machines';

/** Above this many steps per second the page switches from flashes to a heat map. */
const FLASH_MAX_RATE = 20;
/** The editor never goes narrower than this beside it: below it the visualisation breaks. */
const MIN_WORK = 560;
/** The speed the machine runs at when the animation is skipped (Instant). */
const INSTANT_SPEED = SPEEDS.indexOf(10_000);
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
  /** The rev compiler hook (lang/src/compile.ts, adapted to the same shape). Enables Build for rev programs. */
  compile?: AssembleFn;
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
  /** Games: run to the end of this frame / back to the start of this one (or of the one before). Plain step / stepBack otherwise. */
  stepFrame(): Status;
  backFrame(): Status;
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
  let lastCtx: Ctx | null = null;
  let movedOffVisualisation = false;
  let pace: PaceChoice = 'slow';
  let rateIndex = DEFAULT_SPEED;
  /** A typed-in speed in thousands of steps per second, or null while one of the listed speeds is chosen. */
  let customKps: number | null = null;
  let speedMode: 'pace' | 'rate' = 'rate';
  let restoreEditor = false;
  /** Knows where each frame ended, for a game (web/wasm/src/frames.ts). Null for every other program. */
  let frames: FrameTracker | null = null;
  const listeners: Listeners = { update: new Set(), load: new Set(), run: new Set(), engine: new Set() };
  const seekListeners = new Set<(t: number) => void>();
  const emit = <K extends keyof VizEvents>(k: K, e: VizEvents[K]): void => listeners[k].forEach((fn) => fn(e));
  const primary = (): RVM => machines[0].vm;
  /** Apply an action to every machine; the primary's result is the answer. */
  const all = (fn: (v: RVM) => Status): Status => machines.map((m) => fn(m.vm))[0];

  // ---- panels ----
  const editor = editorPanel({ onAssemble: (src, name) => api.assembleAndLoad(src, name), canBuild: !!opts.assemble, onEdit: (src, name) => saveDraft(name, src) });
  const screen = screenPanel();
  const output = consolePanel();
  const game = gamePanel();
  const banners = bannersPanel();
  // two places to type a number for the machine (the visualisation and the output), both feed the input tape
  const numberA = numberInputPanel((n) => void api.pushInput(n));
  const numberB = numberInputPanel((n) => void api.pushInput(n));
  const visualise = visualisePanel(numberA.el);
  // the controls at the top of the Compare tab: program, transport, run-time bar
  const cmpControls = h('div', 'cmp-top');
  const compare = comparePanel(
    {
      onMismatch: () => api.pause(),
      onMeasure: async () => {
        if (!createVm || !program) throw new Error('Load a program first.');
        return measureTracks(createVm, ['logging', 'reversible'], program.image, { garbage: program.garbage });
      },
    },
    cmpControls,
  );
  const canCompare = !!createVm && engines.includes('logging') && engines.includes('reversible');
  compare.setAvailable(canCompare, 'Needs both engines, which needs the WebAssembly build');

  // breakpoints: while nobody else is listening to the editor, a click on the gutter toggles one here
  const breakpoints = new Set<number>();
  editor.onDefaultClick((e) => {
    if (!e.gutter) return;
    if (!breakpoints.delete(e.addr)) breakpoints.add(e.addr);
    editor.api.setBreakpoints([...breakpoints]);
  });

  // ---- runner and transport ----
  const runner = new Runner(
    () => machines,
    (s, running) => {
      if (!running) setRun('paused'); // first, so the redraw shows the stopped state
      refresh(s);
    },
    {
      // the animation sets the pace of a run: one instruction at a time, the next only when the picture is done
      gate: () => (!lastCtx || !visualise.paces(lastCtx) ? 'free' : visualise.busy() ? 'wait' : 'single'),
      // a run stops when the PC reaches a breakpoint
      stopAt: () => breakpoints.size > 0 && breakpoints.has(primary().registers().pc),
      // a game draws only at the end of a frame (not while direction is -1: the frame word is not reliable there)
      frameSync: () => frames !== null && primary().direction > 0,
      // not "the frame word changed": it passes through zero in the middle of its own update
      atFrameBoundary: (mode) => (mode === 'forward' ? frames!.observe() : frames!.atBoundary()),
    },
  );
  const actions = {
    step: () => api.step(),
    stepBack: () => api.stepBack(),
    stepFrame: () => void api.stepFrame(),
    backFrame: () => void api.backFrame(),
    run: (m: RunMode) => api.run(m),
    pause: () => api.pause(),
    stop: () => void api.reset(),
    setSpeed: (i: number) => { rateIndex = i; customKps = null; runner.speedIndex = i; runner.customHz = null; syncSpeed(true); refresh(status); },
    setCustomSpeed: (kps: number) => { customKps = kps; runner.customHz = kps * 1000; syncSpeed(true); refresh(status); },
    setPace: (p: PaceChoice) => { pace = p; runner.speedIndex = p === 'instant' ? INSTANT_SPEED : LEARN_SPEED; syncSpeed(true); refresh(status); },
    setDirection: (d: Direction) => void api.setDirection(d),
  };
  // the debug bar and the top of the Compare tab each have the controls; they move together
  const transport = buildTransport(actions, runner.speedIndex);
  const cmpTransport = buildTransport(actions, runner.speedIndex);
  const transports = [transport, cmpTransport];
  const timeline = timelinePanel(transport, (t) => seek(t));
  const cmpTime = timeBarPanel((t) => seek(t));
  const panels: Panel[] = [editor, screen, output, game, banners, timeline, cmpTime, compare, visualise, numberA, numberB];

  const programBar = buildProgramBar(
    programs,
    (i) => loadSample(i),
    (f) => void f.arrayBuffer().then((b) => api.loadImage(f.name, new Uint8Array(b))),
  );
  // the program can be changed from the top of Compare too: one program, two pickers
  const cmpSelect = buildProgramSelect(programs, (i) => loadSample(i));
  const cmpRow = h('div', 'cmp-row');
  cmpRow.append(cmpSelect.el, cmpTransport.el);
  cmpControls.append(cmpRow, cmpTime.el);
  // programs that exist in assembly and in rev: a switch between the two
  const variant = buildVariantSwitch((lang) => {
    const entry = entryOf(program?.name ?? '');
    const target = entry && [entry, entry.alt].find((e) => e && (e.language ?? 'asm') === lang);
    if (target) loadEntry(target);
  });
  const compareBtn = h('button', 'btn compare-btn', 'Compare engines');
  compareBtn.type = 'button';
  compareBtn.title = 'Run the program on both engines at once and compare what they keep';

  // ---- DOM ----
  const slots: VizSlots = {
    toolbar: h('div', 'slot slot-toolbar'),
    timeline: h('div', 'slot slot-timeline'),
    side: h('div', 'slot slot-side'),
    left: h('div', 'slot slot-left'),
    code: h('div', 'slot slot-code'),
  };
  for (const [k, e] of Object.entries(slots)) e.dataset.slot = k;
  timeline.el.querySelector('.dbg-top')!.insertBefore(slots.toolbar, transport.el.nextSibling);

  // header: name, engine, program
  const header = h('header', 'viz-header');
  const brand = h('h1', 'brand', 'Reversible machine');
  const tagline = h('span', 'tagline dim', 'Step forward, then back: every instruction can be undone.');
  const engineSwitch = buildEngineSwitch(engines, vm.kind, (k) => void api.setEngine(k));
  header.append(brand, tagline, h('span', 'grow'), engineSwitch.el, programBar.el, compareBtn);
  editor.tab.append(variant.el); // right-aligned in the editor header, level with the file name and Build and load

  // left: the editor with the debug bar at its foot (collapsible)
  const ide = h('aside', 'ide');
  ide.setAttribute('aria-label', 'editor and debugger');
  ide.append(slots.code, editor.el, slots.left, slots.timeline, timeline.el);

  // right: three tabs
  // Output: the console and the screen side by side, then the ways to give the machine input
  const outputPane = h('div', 'out');
  const outMain = h('div', 'out-main');
  outMain.append(output.el, screen.el);
  const outInput = h('div', 'out-input');
  outInput.append(numberB.el, screen.keys);
  outputPane.append(game.el, outMain, outInput);

  const rightTabs = new Tabs(
    [
      { id: 'visualisation', label: 'Visualisation', el: visualise.el },
      { id: 'output', label: 'Output', el: outputPane },
      // Compare is a mode, not a tab: the header button switches between it and the normal IDE
      { id: 'compare', label: 'Compare', el: compare.el, disabled: !canCompare, hidden: true },
    ],
    'visualisation',
  );
  const work = h('main', 'work');
  work.append(rightTabs.bar, rightTabs.body, slots.side);
  rightTabs.body.classList.add('grow');
  /**
   * One speed control. While the visualisation shows a simple program it chooses how fast the animation plays (the
   * animation sets the pace of a run); everywhere else it chooses steps per second. Leaving a mode restores the other
   * one's last choice.
   */
  function syncSpeed(force = false): void {
    const animated = rightTabs.active === 'visualisation' && !!program && learnVerdict(program).ok;
    const next = animated ? 'pace' : 'rate';
    if (next !== speedMode || force) {
      speedMode = next;
      if (animated) runner.speedIndex = pace === 'instant' ? INSTANT_SPEED : LEARN_SPEED;
      else runner.speedIndex = rateIndex;
      runner.customHz = animated || customKps === null ? null : customKps * 1000;
      transports.forEach((t) => (animated ? t.setSpeed('pace', pace) : t.setSpeed('rate', rateIndex, customKps)));
    }
    updateMode();
  }

  // Compare takes over the window: the editor is hidden while it is open and comes back when it is left
  let lastTab = 'visualisation';
  rightTabs.onChange((id) => {
    const comparing = id === 'compare';
    compareBtn.setAttribute('aria-pressed', String(comparing));
    compareBtn.textContent = comparing ? 'Back to the IDE' : 'Compare engines';
    rightTabs.bar.hidden = comparing; // nothing to choose between while comparing
    if (comparing && machines.length < 2) {
      restoreEditor = root.dataset.ide === 'open';
      if (restoreEditor) setSidebar(false, false);
      void api.setCompare(true);
    } else if (!comparing && machines.length > 1) {
      void api.setCompare(false);
      if (restoreEditor) setSidebar(true, false);
      restoreEditor = false;
    }
    if (!comparing) lastTab = id;
    syncSpeed();
    refresh(status);
  });
  compareBtn.addEventListener('click', () => rightTabs.select(rightTabs.active === 'compare' ? lastTab : 'compare'));
  compareBtn.disabled = !canCompare;
  compareBtn.title = canCompare ? compareBtn.title : 'Needs both engines, which needs the WebAssembly build';

  // the divider: drag it to resize the editor, double-click to reset, and its button collapses or restores the editor
  const divider = h('div', 'divider');
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-label', 'Resize the editor: drag, or use the left and right arrow keys');
  divider.tabIndex = 0;
  const dividerBtn = h('button', 'divider-btn');
  dividerBtn.type = 'button';
  dividerBtn.title = 'Show or hide the editor (Ctrl+B)';
  divider.append(dividerBtn);

  const split = h('div', 'split');
  split.append(ide, divider, work);
  root.classList.add('viz');
  root.style.setProperty('--engine-diary', ENGINE_COLOUR.logging);
  root.style.setProperty('--engine-rev', ENGINE_COLOUR.reversible);
  root.dataset.ide = 'open';
  root.replaceChildren(header, banners.el, split);

  const MIN_IDE = 260;
  const store = (key: string, value: string | null): void => {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage can be blocked */ }
  };
  const read = (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
  };

  function setSidebar(open: boolean, remember = true): void {
    root.dataset.ide = open ? 'open' : 'closed';
    dividerBtn.setAttribute('aria-pressed', String(open));
    dividerBtn.setAttribute('aria-label', open ? 'Hide the editor' : 'Show the editor');
    dividerBtn.replaceChildren(icon(open ? 'chevronLeft' : 'chevronRight'));
    if (remember) store('viz.ide', open ? 'open' : 'closed');
  }
  dividerBtn.addEventListener('click', () => { restoreEditor = false; setSidebar(root.dataset.ide !== 'open'); });
  dividerBtn.addEventListener('pointerdown', (ev) => ev.stopPropagation()); // a click on the button is not a drag

  function setEditorWidth(px: number | null): void {
    if (px === null) {
      root.style.removeProperty('--ide-w');
      store('viz.ideW', null);
      divider.removeAttribute('aria-valuenow');
      return;
    }
    const max = Math.max(MIN_IDE, Math.min(split.clientWidth * 0.7, split.clientWidth - MIN_WORK - 8));
    const w = Math.round(Math.min(Math.max(px, MIN_IDE), max));
    root.style.setProperty('--ide-w', `${w}px`);
    store('viz.ideW', String(w));
    divider.setAttribute('aria-valuemin', String(MIN_IDE));
    divider.setAttribute('aria-valuemax', String(Math.round(max)));
    divider.setAttribute('aria-valuenow', String(w));
  }
  divider.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); // a drag must not move focus or select text
    if (root.dataset.ide !== 'open') return;
    divider.setPointerCapture(ev.pointerId);
    divider.classList.add('dragging');
  });
  divider.addEventListener('pointermove', (ev) => {
    if (root.dataset.ide === 'open' && divider.hasPointerCapture(ev.pointerId)) setEditorWidth(ev.clientX - split.getBoundingClientRect().left);
  });
  const endDrag = (ev: PointerEvent): void => {
    if (divider.hasPointerCapture(ev.pointerId)) divider.releasePointerCapture(ev.pointerId);
    divider.classList.remove('dragging');
  };
  // by keyboard: the arrows move it (Shift for bigger steps), Home puts it back to the default width
  divider.addEventListener('keydown', (ev) => {
    if (ev.target !== divider || root.dataset.ide !== 'open') return;
    const current = parseFloat(root.style.getPropertyValue('--ide-w')) || ide.getBoundingClientRect().width || 380;
    const step = ev.shiftKey ? 96 : 24;
    if (ev.key === 'ArrowLeft') setEditorWidth(current - step);
    else if (ev.key === 'ArrowRight') setEditorWidth(current + step);
    else if (ev.key === 'Home') setEditorWidth(null);
    else return;
    ev.preventDefault();
  });
  divider.addEventListener('pointerup', endDrag);
  divider.addEventListener('pointercancel', endDrag);
  divider.addEventListener('dblclick', (ev) => {
    if (ev.target === dividerBtn || dividerBtn.contains(ev.target as Node)) return;
    setEditorWidth(null);
  });
  const savedWidth = Number(read('viz.ideW'));
  if (savedWidth > 0) root.style.setProperty('--ide-w', `${savedWidth}px`);
  setSidebar(read('viz.ide') !== 'closed');

  // ---- state flow ----
  function updateMode(): void {
    const fast = runState !== 'paused' && runner.hz > FLASH_MAX_RATE;
    root.dataset.mode = fast ? 'heat' : 'flash';
  }

  function setRun(next: 'fwd' | 'back' | 'paused'): void {
    runState = next;
    root.dataset.run = next;
    transports.forEach((t) => t.setRun(next === 'fwd' ? 'forward' : next === 'back' ? 'back' : null));
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
    root.dataset.compare = String(machines.length > 1);
    engineSwitch.setKind(vmNow.kind);
    engineSwitch.setLocked(rightTabs.active === 'compare');
    transports.forEach((t) => t.setDirection(cur.direction));
    const frame = vmNow.memory(FRAME_ADDR, 1)[0];
    numberB.el.hidden = !!program?.game; // a game reads keys, not typed numbers
    const frameNo = frames !== null && cur.direction > 0 ? frames.frame() : null;
    const ctx: Ctx = { vm: vmNow, snap: cur, prev, program, maxT, branch, branchAt, lostTo, run: runState, rate, frame, machines, notice, view: rightTabs.active, stepHz: runner.hz, heat: root.dataset.mode === 'heat', frameNo, pace, capacity: speedMode === 'pace' ? capacityFor(true, 0) : capacityFor(false, runner.hz) };
    lastCtx = ctx;
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
    frames?.truncateAfter(t);
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
    seekQueued = Math.min(t, maxT);
    if (frames !== null && primary().direction > 0) seekQueued = Math.max(0, ...frames.boundaries.filter((b) => b <= seekQueued!)); // a picture mid-frame is half erased // fallback: a plain runTo, throttled to one per frame
    if (!first) return;
    requestAnimationFrame(() => {
      const target = seekQueued!;
      seekQueued = null;
      api.pause();
      refresh(all((v) => v.runTo(target)));
    });
  }

  const draftKey = (name: string): string => `viz.draft.${name}`;
  /** The assembler, or the rev compiler for a rev program. */
  function toolFor(name: string): AssembleFn | undefined {
    return entryOf(name)?.language === 'rev' ? opts.compile : opts.assemble;
  }
  /** A picker entry, or the other-language twin of one. */
  function entryOf(name: string): ProgramEntry | undefined {
    return programs.flatMap((p) => (p.alt ? [p, p.alt] : [p])).find((p) => p.name === name);
  }
  function saveDraft(name: string, source: string): void {
    const original = entryOf(name)?.source;
    store(draftKey(name), original === undefined || source === original ? null : source);
  }

  function loadSample(i: number): void {
    const p = programs[i];
    if (!p) return;
    programBar.setIndex(i);
    cmpSelect.setIndex(i);
    loadEntry(p);
  }

  function loadEntry(p: ProgramEntry): void {
    // edits to a program are kept in the browser and come back the next time it is picked
    const draft = p.source !== undefined && toolFor(p.name) ? read(draftKey(p.name)) : null;
    const pick = (): void => {
      const at = p.speed === undefined ? DEFAULT_SPEED : SPEEDS.indexOf(p.speed as (typeof SPEEDS)[number]);
      actions.setSpeed(at < 0 ? DEFAULT_SPEED : at);
    };
    if (draft !== null && api.assembleAndLoad(draft, p.name).ok) { pick(); return; }
    try {
      api.loadImage(p.name, p.load(), p.source);
      pick();
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
    () => screen.capturing() && rightTabs.active === 'output',
  );
  const detachShortcuts = attachShortcuts({
    step: () => void api.step(),
    stepBack: () => void api.stepBack(),
    toggleRun: () => (runState === 'fwd' ? api.pause() : api.run('forward')),
    toggleSidebar: () => setSidebar(root.dataset.ide !== 'open'),
    stop: () => void api.reset(),
  });

  const api: VizHandle = {
    root,
    get vm() { return primary(); },
    machines,
    slots,
    engines,
    listing: editor.api,
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
      if (s === 'ok') frames?.observe();
      refresh(s);
      return s;
    },
    stepBack() {
      api.pause();
      const s = all((v) => v.stepBack());
      refresh(s);
      return s;
    },
    stepFrame() {
      if (!frames) return api.step();
      api.pause();
      const r = frames.stepFrame();
      machines.slice(1).forEach((m) => m.vm.runTo(primary().instructionCount));
      const s = r.status === 'limit' ? 'ok' : r.status;
      refresh(s);
      return s;
    },
    backFrame() {
      if (!frames) return api.stepBack();
      api.pause();
      const r = frames.backFrame();
      machines.slice(1).forEach((m) => m.vm.runTo(primary().instructionCount));
      const s = r.status === 'limit' ? 'ok' : r.status;
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
        program.game = entryOf(name)?.game;
        frames = program.game ? new FrameTracker(primary()) : null;
        transports.forEach((t) => t.setFrames(!!program!.game));
        program.language = entryOf(name)?.language;
        const tool = toolFor(name);
        if (source !== undefined && tool) {
          program.listing = tool(source, name).listing.map((r) => ({ addr: r.addr, line: r.line, text: r.text }));
        }
        const verdict = learnVerdict(program);
        // too big to animate: show the output instead, and come back to the visualisation when a simple program loads
        if (!verdict.ok && rightTabs.active === 'visualisation') { rightTabs.select('output'); movedOffVisualisation = true; }
        else if (verdict.ok && movedOffVisualisation) { rightTabs.select('visualisation'); movedOffVisualisation = false; }
        syncSpeed(true);
        const picked = programs.findIndex((p) => p.name === name || p.alt?.name === name); // -1 for a file
        variant.show(picked >= 0 && programs[picked].alt ? (entryOf(name)?.language ?? 'asm') : null);
        programBar.setIndex(picked);
        cmpSelect.setIndex(picked);
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
      const tool = toolFor(name);
      if (!tool) {
        return { ok: false, diagnostics: [{ severity: 'error', line: 0, message: 'no assembler hook was given to mountViz' }], listing: [] };
      }
      const out = tool(source, name);
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
      if (frames) frames = new FrameTracker(primary()); // it will find its way back by replaying
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
