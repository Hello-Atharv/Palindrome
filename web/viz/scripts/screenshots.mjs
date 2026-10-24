// Screenshots of every UI state at 1280x720, from the dev server and the mock VM.
//   node scripts/screenshots.mjs            -> web/viz/screenshots/*.png
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'screenshots');
mkdirSync(out, { recursive: true });

const server = await createServer({ root, server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const load = async (sample) => {
  await page.goto('http://localhost:5199/');
  await page.waitForFunction(() => window.__dev);
  if (sample) await page.evaluate((n) => { const d = window.__dev; const i = d.samples.findIndex((s) => s.name === n); d.viz.loadImage(n, d.samples[i].build().image); }, sample);
};
const shot = async (name) => {
  await page.waitForTimeout(450); // let flash animations settle or be caught consistently
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('shot', name);
};
const dev = (fn, arg) => page.evaluate(fn, arg);
const noScroll = async (name) => {
  const over = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  if (over > 0) console.log(`!! page scrolls by ${over}px in state ${name}`);
};

// 1. paused at t = 0
await load('gradient');
await shot('01-paused-t0');
await noScroll('paused');

// 2. a few forward steps: changed registers flash amber
await dev(() => { const v = window.__dev.viz; for (let i = 0; i < 9; i++) v.step(); });
await page.waitForTimeout(100);
await page.screenshot({ path: join(out, '02-step-forward-flash.png') });
console.log('shot 02-step-forward-flash');

// 3. step back: same registers flash cyan, arrow reversed, no banner
await dev(() => window.__dev.viz.stepBack());
await page.waitForTimeout(100);
await page.screenshot({ path: join(out, '03-step-back-flash.png') });
console.log('shot 03-step-back-flash');

// 4. running forward slowly (flash mode) then fast (heat map)
await dev(() => { const s = document.querySelector('.speed'); s.value = '2'; s.dispatchEvent(new Event('input')); window.__dev.viz.run('forward'); });
await shot('04-run-forward-100ps');
await dev(() => { const s = document.querySelector('.speed'); s.value = '4'; s.dispatchEvent(new Event('input')); });
await shot('05-run-forward-heat');

// 5. running back
await dev(() => { window.__dev.viz.pause(); window.__dev.viz.run('back'); });
await shot('06-run-back');
await dev(() => window.__dev.viz.pause());

// 6. halted
await dev(() => { const v = window.__dev.viz; v.vm.runTo(1_000_000); v.refresh('halted'); });
await shot('07-halted');
await noScroll('halted');

// 7. at start
await load('counting loop');
await dev(() => window.__dev.viz.stepBack());
await shot('08-at-start');

// 8. fault
await load();
await dev(() => {
  const { viz, ProgramBuilder } = window.__dev;
  viz.loadImage('fault demo', new ProgramBuilder().xori(1, 7).add(1, 1).hlt().build().image);
  viz.step(); viz.step();
});
await shot('09-fault');

// 9. new branch: scrub back, then press a key
await load('counting loop');
await dev(() => { const v = window.__dev.viz; for (let i = 0; i < 40; i++) v.step(); for (let i = 0; i < 25; i++) v.stepBack(); v.pushInput(0x41); });
await shot('10-new-branch');

// 10. direction -1: the program runs as its own inverse
await load('counting loop');
await dev(() => { const v = window.__dev.viz; for (let i = 0; i < 10; i++) v.step(); v.setDirection(-1); v.step(); v.step(); });
await shot('11-direction-minus-1');

// 11. memory tab, stack
await load('call / return');
await dev(() => { const v = window.__dev.viz; v.step(); v.step(); v.step(); });
await page.click('.viz-col > .tabs .tab:nth-child(2)');
await page.click('.region-tabs .tab:nth-child(2)');
await shot('12-memory-stack');

// 12. code view
await page.click('.viz-header .tabs .tab:nth-child(2)');
await shot('13-code-view');

// 13. debugger mounted: left pane present, built-in transport hidden
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
await shot('14-debugger-mounted');

await browser.close();
await server.close();
if (errors.length) console.log('browser errors:\n' + errors.join('\n'));

// a contact sheet so the states can be looked through in one page: screenshots/index.html
import { readdirSync, writeFileSync } from 'node:fs';
const files = readdirSync(out).filter((f) => f.endsWith('.png')).sort();
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>viz states</title>
<style>body{background:#0d1117;color:#e6edf3;font:14px system-ui;margin:24px}figure{margin:0 0 24px}img{width:100%;max-width:1280px;border:1px solid #2a3139;border-radius:6px}</style>
${files.map((f) => `<figure><figcaption>${f.replace('.png', '')}</figcaption><img src="${f}"></figure>`).join('\n')}`);
console.log('wrote screenshots/index.html');
