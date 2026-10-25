// Step 4 of Sam's checklist, driven in a real browser against the running dev server (port 5191).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, server: { port: 5191, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const messages = [];
page.on('pageerror', (e) => messages.push(`pageerror: ${e}`));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && messages.push(`${m.type()}: ${m.text()}`));
await page.addInitScript(() => localStorage.clear());
await page.goto('http://localhost:5191/');
await page.waitForFunction(() => window.__dev);

const names = await page.evaluate(() => window.__dev.programs.map((p) => p.name));
console.log('picker:', names.join(' | '));
const state = () => page.evaluate(() => { const v = window.__dev.viz; const s = v.snapshot; return JSON.stringify([s.t, s.pc, Array.from(s.regs), Array.from(v.vm.framebuffer())]); });
const rows = [];
for (const name of names) {
  await page.evaluate((n) => { const { viz, programs } = window.__dev; const p = programs.find((q) => q.name === n); viz.loadImage(n, p.load(), p.source); }, name);
  const loaded = await page.evaluate(() => window.__dev.viz.snapshot.status);
  const r = await page.evaluate(() => {
    const v = window.__dev.viz;
    const t0 = v.snapshot.t;
    for (let i = 0; i < 40; i++) v.step();
    const t40 = v.snapshot.t;
    return { t0, t40 };
  });
  const at40 = await state();
  await page.evaluate(() => window.__dev.viz.run('forward'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__dev.viz.pause());
  const tRun = await page.evaluate(() => window.__dev.viz.snapshot.t);
  const stRun = await page.evaluate(() => window.__dev.viz.snapshot.status);
  // step back all the way, one at a time for the first 40, then check we land on the state we saw at t = 40
  await page.evaluate((t) => { const v = window.__dev.viz; v.vm.runTo(t); v.refresh(); }, r.t40);
  const back40 = await state();
  for (let i = 0; i < 40; i++) await page.evaluate(() => window.__dev.viz.stepBack());
  const t0 = await page.evaluate(() => window.__dev.viz.snapshot.t);
  rows.push(`${name.padEnd(18)} load ${loaded}, 40 steps ok (t=${r.t40}), ran to t=${tRun} (${stRun}), back to t=40 ${back40 === at40 ? 'exact' : 'DIFFERENT'}, 40 step-backs -> t=${t0}`);
}
console.log(rows.join('\n'));

// 4b: Pong, press keys, lose, step back, scrub
console.log('--- Pong');
await page.evaluate(() => { const { viz, programs } = window.__dev; const p = programs.find((q) => q.name === 'pong'); viz.loadImage('pong', p.load(), p.source); });
await page.click('.work > .tabs .tab:nth-child(2)');
await page.evaluate(() => window.__dev.viz.run('forward'));
for (let i = 0; i < 8; i++) { await page.keyboard.press(i % 2 ? 'w' : 's'); await page.waitForTimeout(150); }
await page.waitForFunction(() => window.__dev.viz.snapshot.status === 'halted', null, { timeout: 90000 }).catch(() => {});
const end = await page.evaluate(() => ({ t: window.__dev.viz.snapshot.t, status: window.__dev.viz.snapshot.status, banner: document.querySelector('.banner.halted, .banner.fault')?.textContent ?? '' }));
console.log(`after playing: status ${end.status} at t=${end.t}; banner: ${end.banner}`);
const lostState = await state();
await page.screenshot({ path: join(root, 'screenshots', 'sam-pong-lost.png') });
const back = await page.evaluate(() => { const v = window.__dev.viz; const out = []; for (let i = 0; i < 60; i++) out.push(v.stepBack()); return [...new Set(out)]; });
console.log(`60 step backs after losing -> statuses ${back.join(',')}`);
const mid = Math.floor(end.t / 2);
const scrub = await page.evaluate((t) => { const v = window.__dev.viz; const s = v.vm.runTo(t); v.refresh(); return [s, v.snapshot.t]; }, mid);
console.log(`scrub to t=${mid} -> ${scrub.join(', ')}`);
const fwd = await page.evaluate((t) => { const v = window.__dev.viz; const s = v.vm.runTo(t); v.refresh(); return [s, v.snapshot.t]; }, end.t);
console.log(`scrub forward again to t=${end.t} -> ${fwd.join(', ')}; same state as when lost: ${(await state()) === lostState}`);

// 4d: console in the Output tab
console.log('--- console');
await page.evaluate(() => { const { viz, programs } = window.__dev; const p = programs.find((q) => q.name === 'add two numbers'); viz.loadImage(p.name, p.load(), p.source); viz.pushInput(7); viz.pushInput(5); let n = 0; while (viz.step() === 'ok') n++; });
await page.click('.work > .tabs .tab:nth-child(2)');
console.log('console text:', JSON.stringify(await page.evaluate(() => document.querySelector('.out .console')?.textContent ?? '(no console panel)')));
console.log(messages.length ? 'browser messages:\n' + [...new Set(messages)].join('\n') : 'no browser errors or warnings');
await browser.close();
await server.close();
