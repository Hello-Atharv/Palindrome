import { h } from './dom';
import type { ProgramEntry } from './program';
import type { RunMode } from './runner';
import { SPEEDS } from './runner';

export interface ControlActions {
  step(): void;
  stepBack(): void;
  run(mode: RunMode): void;
  pause(): void;
  reset(): void;
  setSpeed(index: number): void;
  loadSample(index: number): void;
  loadFile(file: File): void;
  setCapture(on: boolean): void;
}

export interface Controls {
  /** Main transport bar. */
  transport: HTMLElement;
  /** Program picker, file loader, key capture toggle. */
  program: HTMLElement;
  setRunning(mode: RunMode | null): void;
  setProgramIndex(index: number): void;
  setLastKey(text: string): void;
}

const speedLabel = (r: number): string => (r === Infinity ? 'max' : r >= 1000 ? `${r / 1000}k/s` : `${r}/s`);

function button(label: string, title: string, cls = ''): HTMLButtonElement {
  const b = h('button', `btn ${cls}`.trim(), label);
  b.title = title;
  b.type = 'button';
  return b;
}

export function buildControls(programs: ProgramEntry[], speedIndex: number, a: ControlActions): Controls {
  const transport = h('div', 'transport');
  const rewind = button('◀◀', 'Run backwards (step back repeatedly)');
  const back = button('◀', 'Step back one instruction');
  const step = button('▶', 'Step forward one instruction');
  const run = button('Run', 'Run forward', 'primary');
  const reset = button('Reset', 'Reload the program at t = 0');
  let mode: RunMode | null = null;

  rewind.addEventListener('click', () => (mode === 'back' ? a.pause() : a.run('back')));
  back.addEventListener('click', () => a.stepBack());
  step.addEventListener('click', () => a.step());
  run.addEventListener('click', () => (mode === 'forward' ? a.pause() : a.run('forward')));
  reset.addEventListener('click', () => a.reset());

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
  speedBox.append(h('span', 'dim', 'speed'), speed, speedOut);
  transport.append(rewind, back, step, run, reset, speedBox);

  const program = h('div', 'program-bar');
  const select = h('select', 'select');
  select.setAttribute('aria-label', 'sample program');
  programs.forEach((p, i) => {
    const o = h('option', '', p.name);
    o.value = String(i);
    if (p.blurb) o.title = p.blurb;
    select.append(o);
  });
  select.addEventListener('change', () => a.loadSample(Number(select.value)));
  const file = h('input');
  file.type = 'file';
  file.accept = '.rvm';
  file.hidden = true;
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) a.loadFile(f);
    file.value = '';
  });
  const load = button('Load .rvm…', 'Load a program image from disk');
  load.addEventListener('click', () => file.click());

  const capture = h('input');
  capture.type = 'checkbox';
  capture.checked = true;
  capture.addEventListener('change', () => a.setCapture(capture.checked));
  const captureLabel = h('label', 'capture');
  const lastKey = h('span', 'last-key mono', 'no key yet');
  captureLabel.append(capture, h('span', '', 'keys → machine'), lastKey);
  program.append(select, load, file, captureLabel);

  return {
    transport,
    program,
    setRunning(m) {
      mode = m;
      run.textContent = m === 'forward' ? 'Pause' : 'Run';
      run.classList.toggle('active', m === 'forward');
      rewind.classList.toggle('active', m === 'back');
    },
    setProgramIndex(i) {
      select.value = String(i);
    },
    setLastKey(text) {
      lastKey.textContent = text;
    },
  };
}
