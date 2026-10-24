import type { Direction, VmKind } from '../../../spec/vm_api';
import { h } from './dom';
import type { ProgramEntry } from './program';
import type { RunMode } from './runner';
import { SPEEDS } from './runner';

export interface TransportActions {
  step(): void;
  stepBack(): void;
  run(mode: RunMode): void;
  pause(): void;
  /** Stop = reset to t = 0, keeping the program. */
  stop(): void;
  setSpeed(index: number): void;
  setDirection(d: Direction): void;
}

export interface Transport {
  el: HTMLElement;
  setRun(mode: RunMode | null): void;
  setDirection(d: Direction): void;
}

const speedLabel = (r: number): string => (r === Infinity ? 'max' : r >= 1000 ? `${r / 1000}k/s` : `${r}/s`);

/** Toolbar button: icon + label + keyboard hint, so nothing relies on the icon alone. */
function button(icon: string, label: string, hint: string, title: string, cls = ''): HTMLButtonElement {
  const b = h('button', `btn ${cls}`.trim());
  b.type = 'button';
  b.title = hint ? `${title} (${hint})` : title;
  const text = h('span', 'btn-text');
  text.append(h('span', 'btn-label', label));
  if (hint) text.append(h('span', 'btn-hint', hint));
  b.append(h('span', 'btn-icon', icon), text);
  return b;
}

export function buildTransport(a: TransportActions, speedIndex: number): Transport {
  const el = h('div', 'transport');
  const stop = button('■', 'Stop', 'Alt+0', 'Stop: reset to t = 0, keep the program');
  const runBack = button('◀◀', 'Run back', '', 'Run backwards in time (repeated step back)', 'run-back');
  const back = button('◀', 'Step back', 'Alt+,', 'Step back: undo one instruction');
  const step = button('▶', 'Step', 'Alt+.', 'Step forward one instruction');
  const run = button('▶▶', 'Run', 'Alt+Space', 'Run forward', 'run-fwd');
  let mode: RunMode | null = null;

  stop.addEventListener('click', () => a.stop());
  runBack.addEventListener('click', () => (mode === 'back' ? a.pause() : a.run('back')));
  back.addEventListener('click', () => a.stepBack());
  step.addEventListener('click', () => a.step());
  run.addEventListener('click', () => (mode === 'forward' ? a.pause() : a.run('forward')));

  const speed = h('input', 'speed');
  speed.type = 'range';
  speed.min = '0';
  speed.max = String(SPEEDS.length - 1);
  speed.value = String(speedIndex);
  speed.setAttribute('aria-label', 'run speed');
  const speedOut = h('span', 'speed-out mono', speedLabel(SPEEDS[speedIndex]));
  speed.addEventListener('input', () => {
    const i = Number(speed.value);
    speedOut.textContent = speedLabel(SPEEDS[i]);
    a.setSpeed(i);
  });
  const speedBox = h('label', 'speed-box');
  speedBox.append(h('span', '', 'Speed'), speed, speedOut);

  // Direction is not time travel: it makes the PROGRAM run as its own inverse (SPEC section 7).
  const dir = button('⇄', 'Reverse', 'program −1', 'Direction -1: run the program as its own inverse. This is not stepping back in time.', 'dir-toggle');
  dir.setAttribute('aria-pressed', 'false');
  let d: Direction = 1;
  dir.addEventListener('click', () => a.setDirection(d === 1 ? -1 : 1));

  el.append(stop, runBack, back, step, run, speedBox, dir);
  return {
    el,
    setRun(m) {
      mode = m;
      run.querySelector('.btn-label')!.textContent = m === 'forward' ? 'Pause' : 'Run';
      run.classList.toggle('active', m === 'forward');
      runBack.querySelector('.btn-label')!.textContent = m === 'back' ? 'Pause' : 'Run back';
      runBack.classList.toggle('active', m === 'back');
    },
    setDirection(next) {
      d = next;
      dir.setAttribute('aria-pressed', String(next === -1));
    },
  };
}

export interface ProgramBar {
  el: HTMLElement;
  setIndex(i: number): void;
}

export function buildProgramBar(programs: ProgramEntry[], onSample: (i: number) => void, onFile: (f: File) => void): ProgramBar {
  const el = h('div', 'program-bar');
  const select = h('select', 'select');
  select.setAttribute('aria-label', 'sample program');
  programs.forEach((p, i) => {
    const o = h('option', '', p.name);
    o.value = String(i);
    if (p.blurb) o.title = p.blurb;
    select.append(o);
  });
  select.addEventListener('change', () => onSample(Number(select.value)));
  const file = h('input');
  file.type = 'file';
  file.accept = '.rvm';
  file.hidden = true;
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) onFile(f);
    file.value = '';
  });
  const load = h('button', 'btn', 'Load .rvm…');
  load.type = 'button';
  load.title = 'Load a program image from disk';
  load.addEventListener('click', () => file.click());
  el.append(select, load, file);
  return { el, setIndex: (i) => { select.value = String(i); } };
}

/** Engine switch. The reversible engine exists in C++ but not in the browser until the WASM build. */
export function buildEngineSwitch(kind: VmKind): HTMLElement {
  const el = h('div', 'engine-switch');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'engine');
  const diary = h('button', 'btn small', 'Diary');
  const rev = h('button', 'btn small', 'Reversible');
  for (const b of [diary, rev]) b.type = 'button';
  diary.setAttribute('aria-pressed', String(kind === 'logging'));
  rev.setAttribute('aria-pressed', String(kind === 'reversible'));
  diary.title = 'Logging engine: normal rewind, keeps a diary of every step';
  rev.disabled = kind !== 'reversible';
  rev.title = 'The reversible engine runs in C++ but is not in the browser until the WASM build lands';
  el.append(diary, rev);
  return el;
}
