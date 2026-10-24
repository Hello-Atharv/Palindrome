// Screenshots of every UI state at 1280x720, from the dev server and the real WebAssembly engines.
//   node scripts/screenshots.mjs            -> web/viz/screenshots/*.png (+ index.html contact sheet)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'screenshots');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const server = await createServer({ root, server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(`${m.type()}: ${m.text()}`));

const load = async (name) => {
  await page.goto('http://localhost:5199/');
  await page.waitForFunction(() => window.__dev);
  if (name) await page.evaluate((n) => { const { viz, programs } = window.__dev; const p = programs.find((q) => q.name === n); viz.loadImage(n, p.load(), p.source); }, name);
};
const shot = async (name, wait = 450) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('shot', name);
};
const dev = (fn, arg) => page.evaluate(fn, arg);
const noScroll = async (name) => {
  const over = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  if (over > 0) console.log(`!! page scrolls by ${over}px in state ${name}`);
};

// 01 paused at t = 0 on the real diary engine
await load('gradient');
await shot('01-paused-t0');
await noScroll('paused');

// 02/03 step forward (amber flash), step back (cyan flash)
await dev(() => { const v = window.__dev.viz; for (let i = 0; i < 9; i++) v.step(); });
await shot('02-step-forward-flash', 100);
await dev(() => window.__dev.viz.stepBack());
await shot('03-step-back-flash', 100);

// 04/05 running: slow (flashes) and fast (heat map)
await dev(() => { const s = document.querySelector('.speed'); s.value = '2'; s.dispatchEvent(new Event('input')); window.__dev.viz.run('forward'); });
await shot('04-run-forward-100ps');
await dev(() => { const s = document.querySelector('.speed'); s.value = '4'; s.dispatchEvent(new Event('input')); });
await shot('05-run-forward-heat');
await dev(() => { window.__dev.viz.pause(); window.__dev.viz.run('back'); });
await shot('06-run-back');
await dev(() => window.__dev.viz.pause());

// 07 halted, 08 at start, 09 fault
await dev(() => { const v = window.__dev.viz; v.vm.runTo(1_000_000); v.refresh('halted'); });
await shot('07-halted');
await noScroll('halted');
await load('loop');
await dev(() => window.__dev.viz.stepBack());
await shot('08-at-start');
await load();
await dev(() => {
  const { viz } = window.__dev;
  viz.assembleAndLoad('start: xori r1, 0x30000\n xst r2, [r1]\n hlt\n', 'fault demo');
  viz.step(); viz.step();
});
await shot('09-fault');

// 10 new branch, 11 direction -1
await load('loop');
await dev(() => { const v = window.__dev.viz; for (let i = 0; i < 40; i++) v.step(); for (let i = 0; i < 25; i++) v.stepBack(); v.pushInput(0x41); });
await shot('10-new-branch');
await load('loop');
await dev(() => { const v = window.__dev.viz; for (let i = 0; i < 10; i++) v.step(); v.setDirection(-1); v.step(); v.step(); });
await shot('11-direction-minus-1');

// 12 memory: stack
await load('call / return');
await dev(() => { const v = window.__dev.viz; v.step(); v.step(); v.step(); });
await page.click('.viz-col > .tabs .tab:nth-child(2)');
await page.click('.region-tabs .tab:nth-child(2)');
await shot('12-memory-stack');

// 13/14 sort: the garbage fills in as it runs (hatched words), then the reversible engine shows 0 B
await load('sort');
await dev(() => { const v = window.__dev.viz; v.vm.runTo(1_000_000); v.refresh(); });
await page.click('.viz-col > .tabs .tab:nth-child(2)');
await page.click('.region-tabs .tab:nth-child(1)');
await shot('13-sort-garbage');
await dev(async () => { await window.__dev.viz.setEngine('reversible'); });
await shot('14-reversible-engine');

// 15/16 cipher: the message as text, then decrypted by flipping the direction (banner)
await page.click('.viz-col > .tabs .tab:nth-child(1)');
await load('cipher');
await dev(() => { const v = window.__dev.viz; v.vm.runTo(1_000_000); v.refresh(); });
await page.click('.viz-col > .tabs .tab:nth-child(2)');
await page.selectOption('.pager select', { label: 'msg  001b' });
await shot('15-cipher-encrypted');
await dev(() => { const v = window.__dev.viz; v.setDirection(-1); v.vm.runTo(v.vm.instructionCount + 5000); v.refresh(); });
await shot('16-cipher-decrypted-direction-minus-1');

// 17 compare view: both engines in lockstep
await load('sort');
await page.click('.viz-col > .tabs .tab:nth-child(3)');
await page.click('.compare-bar .btn');
await page.waitForTimeout(300);
await dev(() => { const v = window.__dev.viz; for (let i = 0; i < 300; i++) v.step(); });
await shot('17-compare');

// 18 code view with a diagnostic, 19 with the real editor assembled
await page.click('.viz-header .tabs .tab:nth-child(2)');
await dev(() => { const e = document.querySelector('.code-editor'); e.value = 'start: xori r1, 5\n add r1, r1\n hlt\n'; });
await page.click('.code-bar .btn');
await shot('18-code-diagnostics');
await load('nested loop');
await page.click('.viz-header .tabs .tab:nth-child(2)');
await page.click('.code-bar .btn');
await shot('19-code-assembled');

// 20 debugger mounted: left pane present, built-in transport hidden
await load('if / else');
await dev(() => {
  const v = window.__dev.viz;
  const p = document.createElement('section');
  p.className = 'panel';
  p.innerHTML = '<header class="panel-head"><h2 class="panel-title">Debugger (stand-in)</h2></header><div class="panel-body">editor, controls, watches go here</div>';
  v.slots.left.append(p);
  v.listing.setBreakpoints([2, 5]);
  v.listing.setCulprit(3);
  v.step(); v.step();
});
await shot('20-debugger-mounted');

await browser.close();
await server.close();

const files = readdirSync(out).filter((f) => f.endsWith('.png')).sort();
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>viz states</title>
<style>body{background:#0d1117;color:#e6edf3;font:14px system-ui;margin:24px}figure{margin:0 0 24px}img{width:100%;max-width:1280px;border:1px solid #2a3139;border-radius:6px}</style>
${files.map((f) => `<figure><figcaption>${f.replace('.png', '')}</figcaption><img src="${f}"></figure>`).join('\n')}`);
if (errors.length) console.log('browser messages:\n' + [...new Set(errors)].join('\n'));
