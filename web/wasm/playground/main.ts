// A small page to watch the real engines (WebAssembly) run the demo programs. Not the product UI (that is
// web/viz); this exists so programs and engines can be seen working before the shell uses them.
import { assemble, type ListingRow } from '../../../asm/src/index.js';
import cipher from '../../../programs/cipher.s?raw';
import sort from '../../../programs/sort.s?raw';
import call from '../../../asm/examples/call.s?raw';
import ifelse from '../../../asm/examples/ifelse_macro.s?raw';
import memory from '../../../asm/examples/memory.s?raw';
import nested from '../../../asm/examples/nested.s?raw';
import { createWasmVm, type WasmVm } from '../src/index.js';

const PROGRAMS: Record<string, string> = {
  'cipher.s: Speck64/128 (decrypt = direction −1)': cipher,
  'sort.s: sort that exposes its garbage': sort,
  'nested.s: loop with an if inside': nested,
  'ifelse_macro.s': ifelse,
  'call.s': call,
  'memory.s: data, framebuffer, neg': memory,
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const hex = (v: number, w = 8): string => (v >>> 0).toString(16).padStart(w, '0');
const human = (b: number): string => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KiB` : `${(b / 1048576).toFixed(1)} MiB`);

let vm: WasmVm | null = null;
let listing: ListingRow[] = [];
let maxT = 0;
let prevRegs: number[] = [];
let prevMem: number[] = [];
let move: 'fwd' | 'back' | 'none' = 'none';
let status = 'ready';
let running: 'fwd' | 'back' | null = null;

async function load(): Promise<void> {
  running = null;
  vm?.destroy();
  const src = Object.values(PROGRAMS)[$<HTMLSelectElement>('program').selectedIndex];
  const result = assemble(src);
  $('diag').textContent = result.diagnostics.map((d) => `line ${d.line}: ${d.severity}: ${d.message}`).join('\n');
  listing = result.listing;
  $('codeinfo').textContent = `${result.code.length} instructions, ${result.data.length} data words`;
  vm = await createWasmVm($<HTMLSelectElement>('engine').value as 'logging' | 'reversible');
  if (!result.ok || vm.loadProgram(result.image!) !== 'ok') {
    status = 'assembler error';
    vm = null;
    render();
    return;
  }
  maxT = 0;
  prevRegs = [];
  prevMem = [];
  move = 'none';
  status = 'ready';
  // optional start state from the URL, e.g. ?p=0&e=reversible&t=500&dir=-1&mem=27 (handy for sharing a view)
  const q = new URLSearchParams(location.search);
  const t0 = Number(q.get('t') ?? 0);
  if (t0 > 0) {
    status = vm.runTo(t0) === 'ok' ? 'ready' : 'halted';
    move = 'fwd';
  }
  if (q.get('dir') === '-1') {
    vm.setDirection(-1);
    maxT = vm.instructionCount;
    const back = Number(q.get('after') ?? 0);
    for (let i = 0; i < back; i++) if (vm.stepForward() !== 'ok') break;
    move = 'fwd';
  }
  render();
}

function memStart(): number {
  const n = parseInt($<HTMLInputElement>('memstart').value, 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function render(): void {
  if (!vm) return;
  const t = vm.instructionCount;
  maxT = Math.max(maxT, t);
  const { regs, pc } = vm.registers();
  const dir = vm.direction;

  $('t').textContent = String(t);
  $('status').textContent = status;
  $('status').className = status === 'fault' || status === 'assembler error' ? 'bad' : status === 'halted' ? 'good' : '';
  $('hist').textContent = human(vm.historyBytes);
  $('hist').className = vm.historyBytes === 0 ? 'good' : '';
  $('dir').textContent = `Direction: ${dir > 0 ? '+1' : '−1'}`;
  $('dir').className = dir < 0 ? 'on' : '';
  $('banner').style.display = dir < 0 ? 'block' : 'none';
  $('branch').textContent = '';
  const scrub = $<HTMLInputElement>('scrub');
  scrub.max = String(maxT);
  scrub.value = String(t);
  scrub.style.accentColor = move === 'back' ? 'var(--back)' : 'var(--fwd)';

  // registers, with the ones that just changed flashing in the colour of the direction of time
  const cls = move === 'back' ? 'back' : 'fwd';
  $('regs').innerHTML = Array.from(regs, (v, i) => {
    const changed = prevRegs.length > 0 && prevRegs[i] !== v && move !== 'none';
    return `<div class="reg ${changed ? cls : ''}"><b>r${i}${i === 14 ? ' sp' : ''}</b>${hex(v)}</div>`;
  }).join('') + `<div class="reg"><b>pc</b>${pc}</div>`;
  prevRegs = Array.from(regs);

  // memory window (8 words per row, with an ASCII column for the demo messages)
  const start = memStart();
  const words = Array.from(vm.memory(start, 64));
  let html = '';
  for (let r = 0; r < 8; r++) {
    let row = `<div class="mrow"><span class="addr">${hex(start + 8 * r, 5)}</span>`;
    let ascii = '';
    for (let c = 0; c < 8; c++) {
      const i = 8 * r + c;
      const changed = prevMem.length > 0 && prevMem[i] !== words[i] && move !== 'none';
      row += `<span class="${changed ? cls : ''}">${hex(words[i])}</span>`;
      for (let b = 0; b < 4; b++) {
        const ch = (words[i] >>> (8 * b)) & 255;
        ascii += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : '·';
      }
    }
    html += row + `<span class="ascii">${ascii.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span></div>`;
  }
  $('mem').innerHTML = html;
  prevMem = words;

  // screen
  const canvas = $<HTMLCanvasElement>('fb');
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(64, 32);
  vm.framebuffer().forEach((w, i) => {
    img.data[4 * i] = (w >>> 16) & 255;
    img.data[4 * i + 1] = (w >>> 8) & 255;
    img.data[4 * i + 2] = w & 255;
    img.data[4 * i + 3] = 255;
  });
  g.putImageData(img, 0, 0);

  // listing with the program counter marked
  $('listing').innerHTML = listing
    .map((r) => `<div class="row${r.addr === pc ? ` pc${dir < 0 ? ' rev' : ''}` : ''}" data-a="${r.addr}"><span>${hex(r.addr, 4)}</span><span>${hex(r.word)}</span><span>${r.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span></div>`)
    .join('');
  $('listing').querySelector('.pc')?.scrollIntoView({ block: 'nearest' });
}

function apply(s: string, direction: 'fwd' | 'back'): void {
  move = direction;
  status = s === 'ok' ? (direction === 'back' ? 'rewinding' : 'running') : s;
  if (s === 'fault') status = `fault: ${vm!.lastError}`;
  if (s !== 'ok') running = null;
}

function stepOnce(direction: 'fwd' | 'back'): void {
  if (!vm) return;
  const before = vm.instructionCount;
  apply(direction === 'fwd' ? vm.stepForward() : vm.stepBack(), direction);
  if (vm.instructionCount === before && status === 'running') status = 'ready';
}

function loop(): void {
  if (!vm || !running) return;
  const n = parseInt($<HTMLSelectElement>('speed').value, 10);
  for (let i = 0; i < n && running; i++) {
    const before = vm.instructionCount;
    const s = running === 'fwd' ? vm.stepForward() : vm.stepBack();
    apply(s, running ?? 'fwd');
    if (vm.instructionCount === before && s === 'ok') break;
  }
  render();
  if (running) requestAnimationFrame(loop);
}

function start(direction: 'fwd' | 'back'): void {
  running = direction;
  requestAnimationFrame(loop);
}

const PROGRAM_SELECT = $<HTMLSelectElement>('program');
Object.keys(PROGRAMS).forEach((name) => PROGRAM_SELECT.append(new Option(name)));
{
  const q = new URLSearchParams(location.search);
  PROGRAM_SELECT.selectedIndex = Math.min(Number(q.get('p') ?? 0), Object.keys(PROGRAMS).length - 1);
  if (q.get('e') === 'logging') $<HTMLSelectElement>('engine').value = 'logging';
  if (q.get('mem')) $<HTMLInputElement>('memstart').value = q.get('mem')!;
}
PROGRAM_SELECT.onchange = () => void load();
$<HTMLSelectElement>('engine').onchange = () => void load();
$('step').onclick = () => { running = null; stepOnce('fwd'); render(); };
$('back').onclick = () => { running = null; stepOnce('back'); render(); };
$('run').onclick = () => start('fwd');
$('runback').onclick = () => start('back');
$('pause').onclick = () => { running = null; status = 'paused'; render(); };
$('reset').onclick = () => { running = null; if (vm) { vm.runTo(0); move = 'back'; status = 'ready'; render(); } };
$('dir').onclick = () => {
  if (!vm) return;
  running = null;
  vm.setDirection(vm.direction > 0 ? -1 : 1);
  maxT = vm.instructionCount; // a host action starts a new branch: the old future is gone
  move = 'none';
  status = 'direction changed; run forward';
  render();
  $('branch').textContent = 'new timeline';
};
$<HTMLInputElement>('scrub').oninput = (e) => {
  if (!vm) return;
  running = null;
  const target = Number((e.target as HTMLInputElement).value);
  move = target < vm.instructionCount ? 'back' : 'fwd';
  const s = vm.runTo(target);
  status = s === 'ok' ? 'scrubbing' : s;
  render();
};
$<HTMLInputElement>('memstart').onchange = () => { prevMem = []; render(); };

void load();
