// A small page to watch the real engines (WebAssembly) run the demo programs, one engine or both side by side.
// Not the product UI (that is web/viz); a working reference for createWasmVm + assemble() in a Vite page.
import { assemble, type ListingRow } from '../../../asm/src/index.js';
import { compile } from '../../../lang/src/compile.js';
import { analyze, formatReport } from '../../../lang/src/report.js';
import { highlightRev } from './highlight.js';
import cipher from '../../../examples/demos/cipher.s?raw';
import sort from '../../../examples/demos/sort.s?raw';
import pong from '../../../examples/demos/pong.s?raw';
import pongRev from '../../../examples/demos/pong.rev?raw';
import fibRev from '../../../examples/rev/fib.rev?raw';
import sort3Rev from '../../../examples/rev/sort3.rev?raw';
import sort8Rev from '../../../examples/rev/sort8.rev?raw';
import call from '../../../examples/asm/call.s?raw';
import ifelse from '../../../examples/asm/ifelse_macro.s?raw';
import memory from '../../../examples/asm/memory.s?raw';
import nested from '../../../examples/asm/nested.s?raw';
import { createWasmVm, FrameTracker, type WasmVm } from '../src/index.js';

type Kind = 'logging' | 'reversible';
interface Program { name: string; src: string; crop: 'top' | 'full'; mem: string; note: string; speed?: string; frames?: boolean; rev?: boolean; blocks?: boolean }

const PROGRAMS: Program[] = [
  { name: 'cipher.s: Speck64/128 (decrypt = direction −1)', src: cipher, crop: 'top', mem: '0x20000',
    note: '<b>The screen is the message.</b> Row 0 first shows 8 dull grey-blue pixels (the plaintext), which turn into 8 random colours (the ciphertext) as it runs. Flip <b>Direction</b> and run: the same program decrypts. The memory panel is on the screen words.' },
  { name: 'sort.s: sort that exposes its garbage', src: sort, crop: 'top', mem: '0x20000',
    note: '<b>The screen is the list.</b> Row 0 is the list (small = green, large = red): watch the compared pair vanish into registers and return swapped, ending as a gradient. Row 1 is the <b>garbage</b>: one pixel per comparison (cyan = swapped). Flip <b>Direction</b> to unsort.' },
  { name: 'pong.s: Pong (W/S or ↑/↓)', src: pong, crop: 'full', mem: '0x1000', speed: '100', frames: true, blocks: true,
    note: '<b>Click this page, press Run, then use W / S or ↑ / ↓</b> to move the paddle (cyan, left edge). Each time the ball returns to the left edge, a paddle there is a hit and a <b>yellow block lights up on the right half: that is your score</b>; otherwise the program halts: game over. <b>◀ Back and the scrubber rewind the game exactly</b> (keys pressed are replayed). The memory panel shows the <b>input log</b>, the only garbage this program keeps (8 bytes a frame). The Direction toggle is exact only for programs that read no input, so use Back for Pong. Try <b>Compare engines</b>.' },
  { name: 'nested.s: loop with an if inside', src: nested, crop: 'full', mem: '0',
    note: 'A loop (r2 counts 1 to 5) with an if inside. Result: r2 = 5, r5 = 1, r6 = 4.' },
  { name: 'ifelse_macro.s', src: ifelse, crop: 'full', mem: '0', note: 'If / else with the macros. Result: r3 = 7.' },
  { name: 'call.s', src: call, crop: 'full', mem: '0x10000', note: 'Calls a procedure twice. The memory panel is on the stack: the return address appears and clears.' },
  { name: 'pong.rev: Pong written in the rev language (W/S or ↑/↓)', src: pongRev, crop: 'full', mem: '0x1000', speed: '100', frames: true, rev: true,
    note: '<b>Click this page, press Run, then W / S or ↑ / ↓.</b> The same game, written in <code>rev</code>, with a <b>permanent grey wall</b> down the middle and your <b>score as a number</b> on the right: it goes up each time you return the ball. <b>◀ Back and the scrubber rewind the game exactly</b>, wall and score included. Edit the source and press <b>Compile &amp; load</b>: errors are underlined as you type, and the report shows what every line costs in machine steps and what the program had to keep (garbage).' },
  { name: 'sort8.rev: the sorting network in rev', src: sort8Rev, crop: 'top', mem: '0', rev: true,
    note: '<b>36 lines of rev instead of 340 of assembly.</b> The report counts the garbage: 14 of the 19 comparator flags are set. The array lives in data memory (<b>memory panel at 0</b>); try changing the numbers and compiling again.' },
  { name: 'sort3.rev: three numbers, with flags', src: sort3Rev, crop: 'full', mem: '0', rev: true,
    note: 'Small enough to read the whole report: each compare-exchange files a flag (f1, f2, f3), and the flags are the garbage.' },
  { name: 'fib.rev: Fibonacci', src: fibRev, crop: 'full', mem: '0', rev: true,
    note: 'Fibonacci, reversibly. The loop counter <code>i</code> ends at 10 and is reported as garbage: it could not be cleared. Direction −1 turns (55, 89) back into (0, 1).' },
  { name: 'memory.s: data, screen, neg', src: memory, crop: 'top', mem: '0x20000', note: 'Writes two words into the screen with xor, then erases one by xoring again.' },
];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const hex = (v: number, w = 8): string => (v >>> 0).toString(16).padStart(w, '0');
const human = (b: number): string => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KiB` : `${(b / 1048576).toFixed(1)} MiB`);
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

interface Machine { kind: Kind; vm: WasmVm; prevRegs: number[]; prevMem: number[] }
let machines: Machine[] = [];
let compare = false;
let listing: ListingRow[] = [];
let maxT = 0;
let move: 'fwd' | 'back' | 'none' = 'none';
let status = 'ready';
let running: 'fwd' | 'back' | null = null;
let diverged: string | null = null;
let paddleMin = 99; // debug: fewest paddle pixels visible in any redraw
let tracker: FrameTracker | null = null; // knows where each frame ended (src/frames.ts), for programs that count frames
let samples = new Map<number, [number, number]>(); // t -> [diary bytes, reversible bytes]

const primary = (): Machine => machines[0];
const q = new URLSearchParams(location.search);

async function load(): Promise<void> {
  running = null;
  machines.forEach((m) => m.vm.destroy());
  machines = [];
  const prog = PROGRAMS[$<HTMLSelectElement>('program').selectedIndex];
  $('revpane').hidden = !prog.rev;
  let result;
  if (prog.rev) {
    const source = $<HTMLTextAreaElement>('src').value;
    const c = compile(source);
    const rs = $('revstatus');
    rs.className = c.ok ? 'good' : 'bad';
    if (!c.ok || !c.assembled) {
      rs.textContent = 'did not compile';
      const lines = c.diagnostics.map((d) => `line ${d.line}: ${d.message}`).join('\n');
      $('diag').textContent = lines;
      $('report').textContent = lines;
      status = 'compile error';
      render();
      return;
    }
    rs.textContent = `compiled: ${c.assembled.code.length} instructions`;
    result = c.assembled;
    $('report').textContent = 'running the cost report...';
    analyze(c, source, 400000).then(
      (r) => { if ($<HTMLTextAreaElement>('src').value === source) $('report').textContent = formatReport(r, 'program.rev'); },
      (e: Error) => { $('report').textContent = `report failed: ${e.message}`; },
    );
  } else {
    result = assemble(prog.src);
  }
  $('diag').textContent = result.diagnostics.map((d) => `line ${d.line}: ${d.severity}: ${d.message}`).join('\n');
  listing = result.listing;
  $('codeinfo').textContent = `${result.code.length} instructions, ${result.data.length} data words`;
  $('note').innerHTML = prog.note;
  const kinds: Kind[] = compare ? ['logging', 'reversible'] : [$<HTMLSelectElement>('engine').value as Kind];
  for (const kind of kinds) {
    const vm = await createWasmVm(kind);
    machines.push({ kind, vm, prevRegs: [], prevMem: [] });
    if (!result.ok || vm.loadProgram(result.image!) !== 'ok') {
      status = 'assembler error';
      machines.forEach((m) => m.vm.destroy());
      machines = [];
      render();
      return;
    }
  }
  maxT = 0;
  move = 'none';
  status = 'ready';
  diverged = null;
  tracker = new FrameTracker(primary().vm);
  samples = new Map([[0, [0, 0]]]); // the chart starts at the origin, so jumping straight to a time still draws a line
  // optional start state from the URL, e.g. ?p=0&t=500&dir=-1&after=300&cmp=1 (handy for sharing a view)
  const t0 = Number(q.get('t') ?? 0);
  if (t0 > 0) {
    status = machines.map((m) => m.vm.runTo(t0)).every((s) => s === 'ok') ? 'ready' : 'halted';
    move = 'fwd';
  }
  if (q.get('dir') === '-1') {
    machines.forEach((m) => m.vm.setDirection(-1));
    maxT = primary().vm.instructionCount;
    const after = Number(q.get('after') ?? 0);
    for (let i = 0; i < after; i++) if (machines.map((m) => m.vm.stepForward()).some((s) => s !== 'ok')) break;
    move = 'fwd';
  }
  render();
}

function memStart(): number {
  const n = parseInt($<HTMLInputElement>('memstart').value, 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Everything that should be identical between the two engines at the same time. */
function snapshot(vm: WasmVm): string {
  const { regs, pc } = vm.registers();
  return [Array.from(regs).join(','), pc, vm.instructionCount, vm.direction, vm.memory(0, 0x300).join(','),
    vm.memory(0x10000, 16).join(','), vm.framebuffer().join(',')].join('|');
}

function drawScreen(canvas: HTMLCanvasElement, vm: WasmVm): void {
  const top = $<HTMLSelectElement>('crop').value === 'top';
  const [cw, ch, scale] = top ? [32, 8, 20] : [64, 32, 8];
  const off = document.createElement('canvas');
  off.width = 64;
  off.height = 32;
  const og = off.getContext('2d')!;
  const img = og.createImageData(64, 32);
  vm.framebuffer().forEach((w, i) => {
    img.data[4 * i] = (w >>> 16) & 255;
    img.data[4 * i + 1] = (w >>> 8) & 255;
    img.data[4 * i + 2] = w & 255;
    img.data[4 * i + 3] = 255;
  });
  og.putImageData(img, 0, 0);
  canvas.width = cw * scale;
  canvas.height = ch * scale;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(off, 0, 0, cw, ch, 0, 0, cw * scale, ch * scale);
  if (top) { // faint pixel borders, so a few pixels can be told apart
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 1;
    for (let x = 0; x <= cw; x++) { g.beginPath(); g.moveTo(x * scale + 0.5, 0); g.lineTo(x * scale + 0.5, ch * scale); g.stroke(); }
    for (let y = 0; y <= ch; y++) { g.beginPath(); g.moveTo(0, y * scale + 0.5); g.lineTo(cw * scale, y * scale + 0.5); g.stroke(); }
  }
}

function regsHtml(m: Machine, regs: Uint32Array, pc: number): string {
  const cls = move === 'back' ? 'back' : 'fwd';
  const html = Array.from(regs, (v, i) => {
    const changed = m.prevRegs.length > 0 && m.prevRegs[i] !== v && move !== 'none';
    return `<div class="reg ${changed ? cls : ''}"><b>r${i}${i === 14 ? ' sp' : ''}</b>${hex(v)}</div>`;
  }).join('') + `<div class="reg"><b>pc</b>${pc}</div>`;
  m.prevRegs = Array.from(regs);
  return html;
}

/** Data words the program has written (non-zero words in the data region): memory the program itself uses, on either engine. */
function programWords(vm: WasmVm): number {
  return vm.memory(0, 0x10000).reduce((n, w) => n + (w !== 0 ? 1 : 0), 0);
}

function drawChart(): void {
  const c = $<HTMLCanvasElement>('chart');
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height, pad = 6;
  g.clearRect(0, 0, W, H);
  const keys = [...samples.keys()].sort((a, b) => a - b);
  const top = Math.max(1, ...keys.map((k) => samples.get(k)![0]));
  const X = (t: number): number => pad + (maxT === 0 ? 0 : (t / maxT) * (W - 2 * pad));
  const Y = (b: number): number => H - pad - (b / top) * (H - 2 * pad - 14);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i <= 4; i++) { const y = pad + 14 + (i * (H - 2 * pad - 14)) / 4; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke(); }
  g.fillStyle = '#8b949e';
  g.font = '12px ui-monospace, Consolas, monospace';
  g.fillText(`${human(top)}`, pad + 2, 12);
  g.fillText(`t = ${maxT}`, W - 90, H - 10);
  for (const [idx, colour, width] of [[0, '#ffb454', 3], [1, '#3fb950', 4]] as const) {
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.beginPath();
    keys.forEach((k, i) => {
      const x = X(k), y = Y(samples.get(k)![idx]);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.stroke();
  }
}

function render(): void {
  if (machines.length === 0) { $('status').textContent = status; return; }
  const m0 = primary();
  const t = m0.vm.instructionCount;
  maxT = Math.max(maxT, t);
  const dir = m0.vm.direction;

  $('t').textContent = String(t);
  $('status').textContent = diverged ?? status;
  $('status').className = diverged || status.startsWith('fault') || status === 'assembler error' ? 'bad' : status === 'halted' ? 'good' : '';
  $('dir').textContent = `Direction: ${dir > 0 ? '+1' : '−1'}`;
  $('dir').className = dir < 0 ? 'on' : '';
  $('banner').style.display = dir < 0 ? 'block' : 'none';
  $('branch').textContent = '';
  $('histwrap').style.display = compare ? 'none' : '';
  const scrub = $<HTMLInputElement>('scrub');
  scrub.max = String(maxT);
  scrub.value = String(t);
  scrub.style.accentColor = move === 'back' ? 'var(--back)' : 'var(--fwd)';
  $('single').style.display = compare ? 'none' : 'grid';
  $('compare').style.display = compare ? 'grid' : 'none';
  $('engine-label').style.display = compare ? 'none' : '';
  $('compare-btn').className = compare ? 'on' : '';

  if (!compare) {
    const { regs, pc } = m0.vm.registers();
    $('hist').textContent = human(m0.vm.historyBytes);
    $('hist').className = m0.vm.historyBytes === 0 ? 'good' : '';
    $('regs').innerHTML = regsHtml(m0, regs, pc);
    drawScreen($<HTMLCanvasElement>('fb'), m0.vm);
    const scoreBox = $('score');
    const isGame = !!PROGRAMS[PROGRAM_SELECT.selectedIndex]?.blocks; // only the block-scoring Pong; pong.rev draws its score as digits
    scoreBox.hidden = !isGame;
    if (isGame) $('scoren').textContent = String(m0.vm.framebuffer().reduce((n, w) => n + (w === 0xffff00 ? 1 : 0), 0) / 4);
    if (q.get('debug') === '1') {
      const fb = m0.vm.framebuffer();
      let cyan = 0;
      for (let r = 0; r < 32; r++) if (fb[r * 64] === 0x00ffff) cyan++;
      if (t > 400) paddleMin = Math.min(paddleMin, cyan);
    }

    const cls = move === 'back' ? 'back' : 'fwd';
    const start = memStart();
    const words = Array.from(m0.vm.memory(start, 64));
    let html = '';
    for (let r = 0; r < 8; r++) {
      let row = `<div class="mrow"><span class="addr">${hex(start + 8 * r, 5)}</span>`;
      let ascii = '';
      for (let c = 0; c < 8; c++) {
        const i = 8 * r + c;
        const changed = m0.prevMem.length > 0 && m0.prevMem[i] !== words[i] && move !== 'none';
        row += `<span class="${changed ? cls : ''}">${hex(words[i])}</span>`;
        for (let b = 0; b < 4; b++) {
          const ch = (words[i] >>> (8 * b)) & 255;
          ascii += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : '·';
        }
      }
      html += row + `<span class="ascii">${esc(ascii)}</span></div>`;
    }
    $('mem').innerHTML = html;
    m0.prevMem = words;

    $('listing').innerHTML = listing
      .map((r) => `<div class="row${r.addr === pc ? ` pc${dir < 0 ? ' rev' : ''}` : ''}"><span>${hex(r.addr, 4)}</span><span>${hex(r.word)}</span><span>${esc(r.text)}</span></div>`)
      .join('');
    // keep the current instruction in view by scrolling the listing box only (scrollIntoView would drag the whole page)
    const list = $('listing');
    const row = list.querySelector<HTMLElement>('.pc');
    if (row) list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2);
  } else {
    const [L, R] = machines;
    for (const [m, regsId, fbId, histId] of [[L, 'regsL', 'fbL', 'histL'], [R, 'regsR', 'fbR', 'histR']] as const) {
      const { regs, pc } = m.vm.registers();
      $(regsId).innerHTML = regsHtml(m, regs, pc);
      drawScreen($<HTMLCanvasElement>(fbId), m.vm);
      $(histId).textContent = human(m.vm.historyBytes);
      $(histId).className = 'big ' + (m.vm.historyBytes === 0 ? 'good' : '');
      $(histId === 'histL' ? 'pmemL' : 'pmemR').textContent = String(programWords(m.vm));
    }
    samples.set(t, [L.vm.historyBytes, R.vm.historyBytes]);
    const same = snapshot(L.vm) === snapshot(R.vm);
    if (!same && !diverged) diverged = `engines DIVERGED at t=${t}`;
    const badge = $('match');
    badge.className = diverged ? 'bad' : 'ok';
    badge.textContent = diverged ?? 'states match ✓  (registers, PC, memory and screen are identical on both engines)';
    drawChart();
  }
}

function applyStatus(s: string, direction: 'fwd' | 'back'): void {
  move = direction;
  status = s === 'ok' ? (direction === 'back' ? 'rewinding' : 'running') : s;
  if (s === 'fault') status = `fault: ${primary().vm.lastError}`;
  if (s !== 'ok') running = null;
}

/** One step on every machine; both engines always get the same action. */
function stepAll(direction: 'fwd' | 'back'): string {
  const ss = machines.map((m) => (direction === 'fwd' ? m.vm.stepForward() : m.vm.stepBack()));
  if (ss.some((s) => s !== ss[0]) && !diverged) diverged = `engines returned different statuses (${ss.join(' vs ')})`;
  return ss[0];
}

function stepOnce(direction: 'fwd' | 'back'): void {
  if (machines.length === 0) return;
  applyStatus(stepAll(direction), direction);
}

function loop(): void {
  loopBody();
}
function loopBody(schedule = true): void {
  if (machines.length === 0 || !running) return;
  const n = parseInt($<HTMLSelectElement>('speed').value, 10);
  // XOR drawing erases before it redraws, so a screen sampled mid-frame is half-erased (the paddle would flicker).
  // For programs that count frames, stop exactly when the frame counter ticks and redraw only then.
  const frameSync = !!PROGRAMS[PROGRAM_SELECT.selectedIndex].frames && q.get('frames') !== '0' && primary().vm.direction > 0 && tracker !== null;
  let frameDone = false;
  for (let i = 0; i < n && running; i++) {
    const before = primary().vm.instructionCount;
    const s = stepAll(running);
    applyStatus(s, running ?? 'fwd');
    if (primary().vm.instructionCount === before && s === 'ok') break;
    // forward: a frame just completed; backward: we are back at the end of a frame. (Not "the FRAME word changed": it passes
    // through zero while being updated. See src/frames.ts.)
    if (frameSync && running && (running === 'fwd' ? tracker!.observe() : tracker!.atBoundary())) {
      frameDone = true;
      break;
    }
  }
  if (frameSync && running && !frameDone) { // still inside a frame: keep going, draw nothing
    if (schedule) requestAnimationFrame(loop);
    return;
  }
  render();
  if (running && schedule) requestAnimationFrame(loop);
}

// ---- the rev editor: colouring and live error marks, as the VS Code extension does ----
const srcBox = $<HTMLTextAreaElement>('src');
let lintTimer: number | undefined;
function paintEditor(withLint: boolean): void {
  const source = srcBox.value;
  const errors = new Map<number, string>();
  const warnings = new Map<number, string>();
  let summary = '';
  if (withLint) {
    const c = compile(source);
    for (const d of c.diagnostics) if (!errors.has(d.line)) errors.set(d.line, d.message);
    for (const d of c.warnings) if (!warnings.has(d.line)) warnings.set(d.line, d.message);
    summary = [
      ...c.diagnostics.map((d) => `line ${d.line}: ${d.message}`),
      ...c.warnings.map((d) => `line ${d.line}: warning: ${d.message}`),
    ].join('\n');
    const lint = $('lint');
    lint.className = c.diagnostics.length ? 'bad' : c.warnings.length ? 'warn' : 'good';
    lint.textContent = summary || 'no errors';
  }
  $('hl').innerHTML = highlightRev(source, errors, warnings);
  $('hl').scrollTop = srcBox.scrollTop;
  $('hl').scrollLeft = srcBox.scrollLeft;
}
srcBox.addEventListener('input', () => {
  paintEditor(false); // colour at once
  clearTimeout(lintTimer);
  lintTimer = window.setTimeout(() => paintEditor(true), 200); // check shortly after typing stops
});
srcBox.addEventListener('scroll', () => { $('hl').scrollTop = srcBox.scrollTop; $('hl').scrollLeft = srcBox.scrollLeft; });
srcBox.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { // indent instead of leaving the box
    e.preventDefault();
    const { selectionStart: a, selectionEnd: b } = srcBox;
    srcBox.setRangeText('  ', a, b, 'end');
    srcBox.dispatchEvent(new Event('input'));
  }
});

const PROGRAM_SELECT = $<HTMLSelectElement>('program');
PROGRAMS.forEach((p) => PROGRAM_SELECT.append(new Option(p.name)));
PROGRAM_SELECT.selectedIndex = Math.min(Number(q.get('p') ?? 0), PROGRAMS.length - 1);
compare = q.get('cmp') === '1';
if (q.get('e') === 'logging') $<HTMLSelectElement>('engine').value = 'logging';
const applyProgramDefaults = (): void => {
  const p = PROGRAMS[PROGRAM_SELECT.selectedIndex];
  if (p.rev) { srcBox.value = q.get('src') ?? p.src; paintEditor(true); }
  $<HTMLSelectElement>('crop').value = p.crop;
  $<HTMLInputElement>('memstart').value = q.get('mem') ?? p.mem;
  $<HTMLSelectElement>('speed').value = q.get('speed') ?? p.speed ?? '20';
};
applyProgramDefaults();

PROGRAM_SELECT.onchange = () => { q.delete('mem'); applyProgramDefaults(); void load(); PROGRAM_SELECT.blur(); };
$<HTMLSelectElement>('engine').onchange = () => { void load(); $<HTMLSelectElement>('engine').blur(); };
$('compare-btn').onclick = () => { compare = !compare; void load(); };
$('compile').onclick = () => void load();
$('step').onclick = () => { running = null; stepOnce('fwd'); render(); };
$('back').onclick = () => { running = null; stepOnce('back'); render(); };
$('run').onclick = () => { running = 'fwd'; requestAnimationFrame(loop); };
$('runback').onclick = () => { running = 'back'; requestAnimationFrame(loop); };
$('pause').onclick = () => { running = null; status = 'paused'; render(); };
$('reset').onclick = () => {
  running = null;
  if (machines.length === 0) return;
  machines.forEach((m) => m.vm.runTo(0));
  move = 'back';
  status = 'ready';
  render();
};
$('dir').onclick = () => {
  if (machines.length === 0) return;
  running = null;
  const d = primary().vm.direction > 0 ? -1 : 1;
  machines.forEach((m) => m.vm.setDirection(d));
  maxT = primary().vm.instructionCount; // a host action starts a new branch: the old future is gone
  tracker?.truncateAfter(maxT);
  samples = new Map([[0, [0, 0]]]);
  move = 'none';
  status = 'direction changed; run forward';
  render();
  $('branch').textContent = 'new timeline';
};
$<HTMLInputElement>('scrub').oninput = (e) => {
  if (machines.length === 0) return;
  running = null;
  const target = Number((e.target as HTMLInputElement).value);
  move = target < primary().vm.instructionCount ? 'back' : 'fwd';
  const ss = machines.map((m) => m.vm.runTo(target));
  status = ss[0] === 'ok' ? 'scrubbing' : ss[0];
  render();
};
$<HTMLInputElement>('memstart').onchange = () => { machines.forEach((m) => (m.prevMem = [])); render(); };
$<HTMLSelectElement>('crop').onchange = () => render();
document.querySelectorAll<HTMLButtonElement>('button[data-jump]').forEach((b) => {
  b.onclick = () => { $<HTMLInputElement>('memstart').value = b.dataset.jump!; machines.forEach((m) => (m.prevMem = [])); render(); };
});

// Keyboard: sent to the machine as input events (SPEC 11.7: a press is the plain code, bit 8 marks a release).
const NAMED: Record<string, number> = { ArrowUp: 0x80, ArrowDown: 0x81, ArrowLeft: 0x82, ArrowRight: 0x83, ' ': 0x20, Enter: 0x0d, Escape: 0x1b };
function keyCode(key: string): number | null {
  if (key in NAMED) return NAMED[key];
  if (key.length === 1) {
    const c = key.toUpperCase().charCodeAt(0);
    return c < 0x80 ? c : null;
  }
  return null;
}
function onKey(ev: KeyboardEvent, up: boolean): void {
  const target = ev.target as HTMLElement | null;
  if (ev.ctrlKey || ev.metaKey || ev.altKey || machines.length === 0) return;
  if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
  const code = keyCode(ev.key);
  if (code === null) return;
  ev.preventDefault(); // always, including auto-repeats: a held arrow key must not scroll the page
  if (ev.repeat) return;
  const value = code | (up ? 0x100 : 0);
  machines.forEach((m) => m.vm.pushInput(value));
  if (primary().vm.instructionCount < maxT) { // pressing a key after scrubbing back starts a new timeline
    maxT = primary().vm.instructionCount;
    tracker?.truncateAfter(maxT);
    samples = new Map([[0, [0, 0]]]);
    $('branch').textContent = 'new timeline';
  }
  $('lastkey').textContent = `${ev.key === ' ' ? 'Space' : ev.key} ${up ? 'up' : 'down'}  (0x${value.toString(16)})`;
}
window.addEventListener('keydown', (e) => onKey(e, false));
window.addEventListener('keyup', (e) => onKey(e, true));

// ?run=1 starts running straight away; ?debug=1 reports the page scroll position in the tab title (for testing the page itself)
void load().then(() => {
  if (q.get('selftest')) {
    running = 'fwd';
    const n = Number(q.get('selftest'));
    for (let i = 0; i < n && running; i++) loopBody(false);
    document.title = `selftest t=${machines[0].vm.instructionCount} paddleMin=${paddleMin} status=${status}`;
    return;
  }
  if (q.get('run') === '1') { running = 'fwd'; requestAnimationFrame(loop); }
});
if (q.get('debug') === '1' && !q.get('selftest')) setInterval(() => { document.title = `scrollY=${window.scrollY} t=${machines[0]?.vm.instructionCount ?? 0} paddleMin=${paddleMin}`; }, 100);
