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
  /** Games only: run to the end of this frame / go back to the start of it (or of the one before). */
  stepFrame(): void;
  backFrame(): void;
  run(mode: RunMode): void;
  pause(): void;
  /** Stop = reset to t = 0, keeping the program. */
  stop(): void;
  setSpeed(index: number): void;
  /** A speed typed in, in thousands of steps per second. */
  setCustomSpeed(kps: number): void;
  setPace(p: PaceChoice): void;
  setDirection(d: Direction): void;
}

export interface Transport {
  el: HTMLElement;
  setRun(mode: RunMode | null): void;
  setDirection(d: Direction): void;
  /** Show the frame buttons (for a program that counts frames). */
  setFrames(on: boolean): void;
  /**
   * The one speed control. For a program with the animation it offers Slow / Normal / Fast / Instant; for everything
   * else, steps per second. The caller sets the runner's speed itself.
   */
  setSpeed(mode: 'pace', value: PaceChoice): void;
  /** `custom` is a typed-in speed in thousands of steps per second, or null when one of the listed speeds is chosen. */
  setSpeed(mode: 'rate', value: number, custom?: number | null): void;
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
  const back = iconButton('stepBack', 'Step back one instruction', 'Alt+,', 'labelled step-back');
  const step = iconButton('step', 'Step forward one instruction', 'Alt+.', 'labelled step-fwd');
  // the two buttons the whole project is about get a word, when the bar is wide enough to show it
  back.append(h('span', 'ibtn-label', 'Back'));
  step.append(h('span', 'ibtn-label', 'Step'));
  const backFrame = iconButton('backFrame', 'Back one frame', '', 'frame-btn');
  const stepFrame = iconButton('stepFrame', 'Forward one frame', '', 'frame-btn');
  backFrame.hidden = true;
  stepFrame.hidden = true;
  const run = iconButton('play', 'Run forward', 'Alt+Space', 'run-fwd');
  let mode: RunMode | null = null;

  stop.addEventListener('click', () => a.stop());
  runBack.addEventListener('click', () => (mode === 'back' ? a.pause() : a.run('back')));
  back.addEventListener('click', () => a.stepBack());
  backFrame.addEventListener('click', () => a.backFrame());
  stepFrame.addEventListener('click', () => a.stepFrame());
  step.addEventListener('click', () => a.step());
  run.addEventListener('click', () => (mode === 'forward' ? a.pause() : a.run('forward')));

  const speed = h('select', 'select tiny');
  speed.setAttribute('aria-label', 'run speed');
  let speedMode: 'pace' | 'rate' = 'rate';
  const fill = (options: [string, string][], value: string): void => {
    speed.replaceChildren(...options.map(([v, text]) => Object.assign(h('option', '', text), { value: v })));
    speed.value = value;
  };
  // a speed of your own, in thousands of steps per second
  const custom = h('label', 'speed-custom');
  const customField = h('input', 'speed-custom-field mono');
  customField.type = 'number';
  customField.min = '0.001';
  customField.max = '100000';
  customField.step = 'any';
  customField.setAttribute('aria-label', 'custom speed in thousands of steps per second');
  custom.append(customField, h('span', 'dim', 'k/s'));
  custom.hidden = true;
  let curIndex = speedIndex;
  const showRate = (index: number, kps: number | null = null): void => {
    speedMode = 'rate';
    curIndex = index;
    speed.title = 'Run speed in steps per second, or a custom one in k/s';
    fill([...SPEEDS.map((r, i): [string, string] => [String(i), speedLabel(r)]), ['custom', 'custom…']], kps === null ? String(index) : 'custom');
    custom.hidden = kps === null;
    if (kps !== null && document.activeElement !== customField) customField.value = String(kps);
  };
  const applyCustom = (): void => {
    const kps = Number(customField.value);
    if (customField.value.trim() !== '' && Number.isFinite(kps) && kps > 0) a.setCustomSpeed(Math.min(kps, 100000));
  };
  customField.addEventListener('change', applyCustom);
  customField.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { applyCustom(); customField.blur(); } // so the arrow keys go back to the game
    ev.stopPropagation();
  });
  const showPace = (p: PaceChoice): void => {
    speedMode = 'pace';
    speed.title = 'How fast the animation plays. Instant skips it.';
    fill(PACE_CHOICES.map((x) => [x, x[0].toUpperCase() + x.slice(1)]), p);
  };
  showRate(speedIndex);
  speed.addEventListener('change', () => {
    if (speedMode === 'pace') {
      speed.blur();
      a.setPace(speed.value as PaceChoice);
    } else if (speed.value === 'custom') {
      // start from the speed that was running, and let the user type over it
      const now = SPEEDS[curIndex];
      customField.value = String(Number.isFinite(now) ? now / 1000 : 1000);
      custom.hidden = false;
      applyCustom();
      customField.focus();
      customField.select();
    } else {
      speed.blur();
      a.setSpeed(Number(speed.value));
    }
  });

  // Direction is not time travel: it makes the PROGRAM run as its own inverse (SPEC section 7).
  const dir = iconButton('reverse', 'Direction −1: run the program as its own inverse (this is not stepping back in time). Not exact for programs that read input, such as Pong: use Back there.', '', 'dir-toggle');
  dir.setAttribute('aria-pressed', 'false');
  let d: Direction = 1;
  dir.addEventListener('click', () => a.setDirection(d === 1 ? -1 : 1));

  el.append(stop, runBack, backFrame, back, step, stepFrame, run, h('span', 'tsep'), dir, speed, custom);
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
    setFrames(on) {
      backFrame.hidden = !on;
      stepFrame.hidden = !on;
    },
    setSpeed(mode: 'pace' | 'rate', value: PaceChoice | number, kps?: number | null) {
      if (mode === 'pace') {
        showPace(value as PaceChoice);
        custom.hidden = true;
      } else {
        showRate(value as number, kps ?? null);
      }
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
  select.addEventListener('change', () => { onSample(Number(select.value)); select.blur(); }); // so the arrow keys reach the game
  return { el: select, setIndex: (i) => { select.value = String(i); } };
}

export function buildProgramBar(programs: ProgramEntry[], onSample: (i: number) => void): ProgramBar {
  const el = h('div', 'program-bar');
  const picker = buildProgramSelect(programs, onSample);
  el.append(picker.el);
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
  const el = h('div', 'segmented engine-switch');
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
    b.dataset.kind = d.kind;
    const ok = available.includes(d.kind);
    b.disabled = !ok;
    b.title = ok ? d.tip : 'This engine is not available here: it needs the WebAssembly build';
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

export interface VariantSwitch {
  el: HTMLElement;
  /** Show the switch with this language pressed, or hide it (null) for a program that exists in one language only. */
  show(current: 'asm' | 'rev' | null): void;
}

/** ".s | .rev": the same program in assembly or in the rev language. */
export function buildVariantSwitch(onPick: (lang: 'asm' | 'rev') => void): VariantSwitch {
  const el = h('div', 'segmented variant');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'language of this program');
  el.classList.add('off'); // it keeps its place in the editor header, invisible, so nothing beside it moves
  const defs = [
    { lang: 'asm' as const, label: '.s', tip: 'The assembly version of this program' },
    { lang: 'rev' as const, label: '.rev', tip: 'The version written in the rev language' },
  ];
  const buttons = defs.map((d) => {
    const b = h('button', 'seg mono', d.label);
    b.type = 'button';
    b.title = d.tip;
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-pressed') !== 'true') onPick(d.lang);
      b.blur();
    });
    el.append(b);
    return { lang: d.lang, b };
  });
  return {
    el,
    show(current) {
      el.classList.toggle('off', current === null);
      buttons.forEach(({ b }) => (b.tabIndex = current === null ? -1 : 0));
      buttons.forEach(({ lang, b }) => b.setAttribute('aria-pressed', String(lang === current)));
    },
  };
}
