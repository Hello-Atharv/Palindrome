import type { Direction, VmKind } from '../../../spec/vm_api';
import { h } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';
import type { ProgramEntry } from './program';
import type { RunMode } from './runner';
import { SPEEDS } from './runner';

/** How fast the sphere moves while an animated program runs; 'instant' skips the animation. */
export type PaceChoice = 'slow' | 'normal' | 'fast' | 'instant';
export const PACE_CHOICES: readonly PaceChoice[] = ['slow', 'normal', 'fast', 'instant'];

export interface TransportActions {
  step(): void;
  stepBack(): void;
  run(mode: RunMode): void;
  pause(): void;
  /** Stop = reset to t = 0, keeping the program. */
  stop(): void;
  setSpeed(index: number): void;
  setPace(p: PaceChoice): void;
  setDirection(d: Direction): void;
}

export interface Transport {
  el: HTMLElement;
  setRun(mode: RunMode | null): void;
  setDirection(d: Direction): void;
  /**
   * The one speed control. For a program with the animation it offers Slow / Normal / Fast / Instant; for everything
   * else, steps per second. The caller sets the runner's speed itself.
   */
  setSpeed(mode: 'pace', value: PaceChoice): void;
  setSpeed(mode: 'rate', value: number): void;
}

const speedLabel = (r: number): string => (r === Infinity ? 'max' : r >= 1000 ? `${r / 1000}k/s` : `${r}/s`);

/** A small icon button. The name lives in the tooltip and the accessible label. */
function iconButton(name: IconName, label: string, hint: string, cls = ''): HTMLButtonElement {
  const b = h('button', `ibtn ${cls}`.trim());
  b.type = 'button';
  b.title = hint ? `${label} (${hint})` : label;
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  return b;
}

function setIcon(b: HTMLButtonElement, name: IconName): void {
  b.replaceChildren(icon(name));
}

/** The debug controls: stop, run back, step back, step, run/pause, reverse program, speed. Small, icon only. */
export function buildTransport(a: TransportActions, speedIndex: number): Transport {
  const el = h('div', 'transport');
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'debug controls');
  const stop = iconButton('stop', 'Stop and go back to the start', 'Alt+0');
  const runBack = iconButton('playBack', 'Run backwards in time', '', 'run-back');
  const back = iconButton('stepBack', 'Step back one instruction', 'Alt+,');
  const step = iconButton('step', 'Step forward one instruction', 'Alt+.');
  const run = iconButton('play', 'Run forward', 'Alt+Space', 'run-fwd');
  let mode: RunMode | null = null;

  stop.addEventListener('click', () => a.stop());
  runBack.addEventListener('click', () => (mode === 'back' ? a.pause() : a.run('back')));
  back.addEventListener('click', () => a.stepBack());
  step.addEventListener('click', () => a.step());
  run.addEventListener('click', () => (mode === 'forward' ? a.pause() : a.run('forward')));

  const speed = h('select', 'select tiny');
  speed.setAttribute('aria-label', 'run speed');
  let speedMode: 'pace' | 'rate' = 'rate';
  const fill = (options: [string, string][], value: string): void => {
    speed.replaceChildren(...options.map(([v, text]) => Object.assign(h('option', '', text), { value: v })));
    speed.value = value;
  };
  const showRate = (index: number): void => {
    speedMode = 'rate';
    speed.title = 'Run speed in steps per second';
    fill(SPEEDS.map((r, i) => [String(i), speedLabel(r)]), String(index));
  };
  const showPace = (p: PaceChoice): void => {
    speedMode = 'pace';
    speed.title = 'How fast the animation plays. Instant skips it.';
    fill(PACE_CHOICES.map((x) => [x, x[0].toUpperCase() + x.slice(1)]), p);
  };
  showRate(speedIndex);
  speed.addEventListener('change', () => (speedMode === 'pace' ? a.setPace(speed.value as PaceChoice) : a.setSpeed(Number(speed.value))));

  // Direction is not time travel: it makes the PROGRAM run as its own inverse (SPEC section 7).
  const dir = iconButton('reverse', 'Direction −1: run the program as its own inverse (this is not stepping back in time)', '', 'dir-toggle');
  dir.setAttribute('aria-pressed', 'false');
  let d: Direction = 1;
  dir.addEventListener('click', () => a.setDirection(d === 1 ? -1 : 1));

  el.append(stop, runBack, back, step, run, h('span', 'tsep'), dir, speed);
  return {
    el,
    setRun(m) {
      mode = m;
      setIcon(run, m === 'forward' ? 'pause' : 'play');
      setIcon(runBack, m === 'back' ? 'pause' : 'playBack');
      run.title = m === 'forward' ? 'Pause (Alt+Space)' : 'Run forward (Alt+Space)';
      runBack.title = m === 'back' ? 'Pause' : 'Run backwards in time';
      run.classList.toggle('active', m === 'forward');
      runBack.classList.toggle('active', m === 'back');
    },
    setDirection(next) {
      d = next;
      dir.setAttribute('aria-pressed', String(next === -1));
    },
    setSpeed(mode: 'pace' | 'rate', value: PaceChoice | number) {
      if (mode === 'pace') showPace(value as PaceChoice);
      else showRate(value as number);
    },
  };
}

export interface ProgramBar {
  el: HTMLElement;
  setIndex(i: number): void;
}

/** The program picker alone. There are two of them (the header and the top of Compare); the shell keeps them in step. */
export function buildProgramSelect(programs: ProgramEntry[], onSample: (i: number) => void): ProgramBar {
  const select = h('select', 'select program-select');
  select.setAttribute('aria-label', 'program');
  programs.forEach((p, i) => {
    const o = h('option', '', p.name);
    o.value = String(i);
    if (p.blurb) o.title = p.blurb;
    select.append(o);
  });
  select.addEventListener('change', () => onSample(Number(select.value)));
  return { el: select, setIndex: (i) => { select.value = String(i); } };
}

export function buildProgramBar(programs: ProgramEntry[], onSample: (i: number) => void, onFile: (f: File) => void): ProgramBar {
  const el = h('div', 'program-bar');
  const picker = buildProgramSelect(programs, onSample);
  const file = h('input');
  file.type = 'file';
  file.accept = '.rvm';
  file.hidden = true;
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) onFile(f);
    file.value = '';
  });
  const load = h('button', 'btn', 'Open .rvm file');
  load.type = 'button';
  load.title = 'Load a program image from disk';
  load.addEventListener('click', () => file.click());
  el.append(picker.el, load, file);
  return { el, setIndex: picker.setIndex };
}

export interface EngineSwitch {
  el: HTMLElement;
  setKind(kind: VmKind): void;
  /** While both engines run side by side the switch has nothing to choose. */
  setLocked(locked: boolean): void;
}

/**
 * Engine switch: Diary (the logging VM, keeps history) or Reversible (no history). An engine the page cannot create
 * (no WASM module) stays disabled with a tooltip that says why.
 */
export function buildEngineSwitch(available: readonly VmKind[], kind: VmKind, onSelect: (k: VmKind) => void): EngineSwitch {
  const el = h('div', 'segmented');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'engine');
  const defs: { kind: VmKind; label: string; tip: string }[] = [
    { kind: 'logging', label: 'Diary', tip: 'Logging engine: normal rewind, keeps a diary of every step' },
    { kind: 'reversible', label: 'Reversible', tip: 'Reversible engine: rewinds by computing inverses, keeps no history' },
  ];
  let locked = false;
  const buttons = defs.map((d) => {
    const b = h('button', 'seg', d.label);
    b.type = 'button';
    const ok = available.includes(d.kind);
    b.disabled = !ok;
    b.title = ok ? d.tip : 'This engine is not available here: it needs the WebAssembly build (web/wasm)';
    b.addEventListener('click', () => onSelect(d.kind));
    el.append(b);
    return { kind: d.kind, b, ok, tip: b.title };
  });
  const setKind = (k: VmKind): void => buttons.forEach(({ kind: bk, b }) => b.setAttribute('aria-pressed', String(bk === k)));
  const setLocked = (next: boolean): void => {
    if (next === locked) return;
    locked = next;
    for (const x of buttons) {
      x.b.disabled = locked || !x.ok;
      x.b.title = locked ? 'Both engines are running in Compare. Leave Compare to choose one.' : x.tip;
    }
  };
  setKind(kind);
  return { el, setKind, setLocked };
}
