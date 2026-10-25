// Screenshots of the UI states at 1280x720, from the dev server and the real WebAssembly engines.
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
await page.addInitScript(() => localStorage.clear()); // every page load starts from the defaults
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(`${m.type()}: ${m.text()}`));

const TAB = (n) => `.work > .tabs .tab:nth-child(${n})`; // 1 Visualisation, 2 Output, 3 Compare
const load = async (name) => {
  await page.goto('http://localhost:5199/');
  await page.waitForFunction(() => window.__dev);
  if (name) await page.evaluate((n) => { const { viz, programs } = window.__dev; const p = programs.find((q) => q.name === n); viz.loadImage(n, p.load(), p.source); }, name);
};
const shot = async (name, wait = 400) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('shot', name);
};
const dev = (fn, arg) => page.evaluate(fn, arg);
const noScroll = async (name) => {
  const over = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  if (over > 0) console.log(`!! page scrolls by ${over}px in state ${name}`);
};

// 01 the first screen: editor + debug bar on the left, the visualisation on the right
await load('if / else');
await shot('01-first-screen');
await noScroll('first screen');

// 02-03 a step in the visualisation: the sphere travelling along its wire (slow pace)
await dev(() => window.__dev.viz.step());
await shot('02-sphere-fetch', 1500);
await page.waitForTimeout(2500);
await shot('03-sphere-later', 600);
await page.waitForTimeout(9000);

// 04 stepping back plays the same wires in cyan
await dev(() => window.__dev.viz.stepBack());
await shot('04-step-back-cyan', 1800);
await page.waitForTimeout(9000);

// 05 running in the visualisation: the animation sets the pace, one instruction at a time
await load('loop');
await dev(() => window.__dev.viz.run('forward'));
await shot('05-run-paced-by-animation', 3500);
await dev(() => window.__dev.viz.pause());

// 06 direction -1
await load('loop');
await dev(() => { const v = window.__dev.viz; for (let i = 0; i < 6; i++) v.vm.stepForward(); v.refresh(); v.setDirection(-1); v.step(); });
await shot('06-direction-minus-1', 1500);

// 07 output: the sort program's numbers, the garbage and the registers
await load('sort');
await dev(() => { const v = window.__dev.viz; v.vm.runTo(1_000_000); v.refresh(); });
await page.click(TAB(2));
await shot('07-output-sort');

// 08 output: the cipher message as text, and the screen
await load('cipher');
await page.click(TAB(2));
await dev(() => { const v = window.__dev.viz; v.vm.runTo(1_000_000); v.refresh(); });
await shot('08-output-cipher-text');
await dev(() => { const v = window.__dev.viz; v.setDirection(-1); v.vm.runTo(v.vm.instructionCount + 5000); v.refresh(); });
await shot('09-output-cipher-decrypted');

// 10 output: graphics
await load('gradient');
await page.click(TAB(2));
await dev(() => { const v = window.__dev.viz; v.vm.runTo(1_000_000); v.refresh(); });
await shot('10-output-graphics');

// 11 compare: measure the forward and back tracks, and run side by side
await load('sort');
await page.click('.compare-btn');
await page.waitForTimeout(800);
await dev(() => { const v = window.__dev.viz; for (let i = 0; i < 120; i++) v.step(); });
await page.click('.cmp-section .btn.primary');
await page.waitForFunction(() => !document.querySelector('.cmp-table')?.hidden, null, { timeout: 60000 });
await shot('11-compare');
await page.evaluate(() => document.querySelector('.cmp-body').scrollTo(0, 99999));
await shot('11b-compare-chart');
await page.click('.compare-btn'); // back out: the editor returns
await shot('11c-compare-left');

// 12 the editor: a breakpoint and the current line, on a program with source
await load('nested loop');
await page.click('.ed-ln:nth-child(5)');
await dev(() => { const v = window.__dev.viz; v.step(); v.step(); v.step(); });
await page.click(TAB(2));
await shot('12-editor-breakpoint-output');

// 13 an assembler error in the editor
await dev(() => { const t = document.querySelector('.ed-text'); t.value = 'start: xori r1, 5\n add r1, r1\n hlt\n'; t.dispatchEvent(new Event('input')); });
await page.click('.ed-build');
await shot('13-editor-problems');

// 14 a fault
await dev(() => { const { viz } = window.__dev; viz.assembleAndLoad('start: xori r1, 0x30000\n xst r2, [r1]\n hlt\n', 'fault demo'); viz.step(); viz.step(); });
await page.click(TAB(2));
await shot('14-fault');

// 15 the editor and debug controls collapsed
await load('if / else');
await page.click('.divider-btn');
await shot('15-editor-collapsed');

// 17-19 add two numbers: send 7 and 5 through the box, then watch the machine read them
await load('add two numbers');
await shot('17-add-two-empty');
await page.fill('.vis .numin-field', '7');
await page.click('.vis .numin .btn');
await page.fill('.vis .numin-field', '5');
await page.click('.vis .numin .btn');
await dev(() => { const v = window.__dev.viz; v.step(); v.step(); v.step(); });
await page.waitForTimeout(500);
await dev(() => window.__dev.viz.step());
await shot('18-add-two-reading-input', 1700);
await page.waitForTimeout(8000);
await dev(() => { const v = window.__dev.viz; v.run('forward'); });
await page.waitForTimeout(500);
await dev(() => { const v = window.__dev.viz; v.pause(); v.vm.runTo(1000); v.refresh(); });
await shot('19-add-two-done');
await page.click(TAB(2));
await shot('19b-add-two-console');

// 21 the blank program, and a running program with the bar full
await load('my program');
await shot('21-my-program');
await load('pong');
await dev(() => { const v = window.__dev.viz; v.vm.runTo(7000); v.refresh(); });
await page.click(TAB(2));
await shot('22-time-bar-past-capacity');

// 20 the editor resized by dragging the divider
await load('if / else');
const box = await page.locator('.divider').boundingBox();
await page.mouse.move(box.x + 4, box.y + 200);
await page.mouse.down();
await page.mouse.move(700, box.y + 200, { steps: 6 });
await page.mouse.up();
await shot('20-editor-resized');

// 16 a program too big to animate
await load('sort');
await page.click(TAB(1));
await shot('16-visualisation-too-big');

await browser.close();
await server.close();

const files = readdirSync(out).filter((f) => f.endsWith('.png')).sort();
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>viz states</title>
<style>body{background:#0d1117;color:#e6edf3;font:14px system-ui;margin:24px}figure{margin:0 0 24px}img{width:100%;max-width:1280px;border:1px solid #2a3139;border-radius:6px}</style>
${files.map((f) => `<figure><figcaption>${f.replace('.png', '')}</figcaption><img src="${f}"></figure>`).join('\n')}`);
if (errors.length) console.log('browser messages:\n' + [...new Set(errors)].join('\n'));
