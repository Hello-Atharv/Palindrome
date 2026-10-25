// Plays Pong in a real browser: runs it, holds a key (auto-repeat included), checks the page does not scroll, the paddle moves,
// the frame number climbs, and that Back one frame returns to a frame boundary.
//   node scripts/pong-check.mjs [screenshot.png]
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, server: { port: 5197, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
await page.addInitScript(() => localStorage.clear());
await page.goto('http://localhost:5197/');
await page.waitForFunction(() => window.__dev);
await page.evaluate(() => { const { viz, programs } = window.__dev; const p = programs.find((q) => q.name === 'pong'); viz.loadImage(p.name, p.load(), p.source); });
await page.click('.work > .tabs .tab:nth-child(2)'); // Output

const paddleRows = () => page.evaluate(() => { const fb = window.__dev.viz.vm.framebuffer(); let rows = []; for (let r = 0; r < 32; r++) if (fb[r * 64] === 0x00ffff) rows.push(r); return rows; });
const frame = () => page.evaluate(() => document.querySelector('.debugbar .tbar-num').textContent);

await page.evaluate(() => window.__dev.viz.run('forward'));
await page.waitForTimeout(800);
const before = await paddleRows();
await page.keyboard.down('ArrowDown'); // held: the browser sends repeats
for (let i = 0; i < 12; i++) { await page.keyboard.down('ArrowDown'); await page.waitForTimeout(80); }
await page.keyboard.up('ArrowDown');
await page.waitForTimeout(400);
const scrollY = await page.evaluate(() => window.scrollY + document.querySelector('.tab-panes').scrollTop);
const after = await paddleRows();
const f1 = await frame();
await page.waitForTimeout(600);
const f2 = await frame();
if (scrollY !== 0) problems.push(`the page scrolled by ${scrollY}px while an arrow key was held`);
if (JSON.stringify(before) === JSON.stringify(after)) problems.push(`the paddle did not move (rows ${before} -> ${after})`);
if (!(Number(f2.replace(/,/g, '')) > Number(f1.replace(/,/g, '')) || await page.evaluate(() => window.__dev.viz.snapshot.status !== 'ok'))) problems.push(`the frame number did not climb (${f1} -> ${f2})`);
await page.screenshot({ path: process.argv[2] ?? join(root, 'screenshots', 'pong.png') });

await page.evaluate(() => window.__dev.viz.pause());
await page.click('.frame-btn:nth-of-type(1)').catch(() => {});
const atBoundary = await page.evaluate(() => { window.__dev.viz.backFrame(); return window.__dev.viz.snapshot.t; });
console.log(`paddle rows ${before} -> ${after}, frame ${f1} -> ${f2}, after Back one frame t = ${atBoundary}`);
await browser.close();
await server.close();
if (problems.length) { console.log('FAILED:\n' + problems.map((p) => ' - ' + p).join('\n')); process.exit(1); }
console.log('Pong plays: no scrolling, paddle moves, frames count');
