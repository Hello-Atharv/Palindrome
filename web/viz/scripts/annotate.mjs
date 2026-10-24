// An annotated screenshot of the UI: numbered markers drawn over the real elements.
//   node scripts/annotate.mjs  -> screenshots/annotated.png
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'screenshots');
mkdirSync(out, { recursive: true });

const server = await createServer({ root, server: { port: 5197, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5197/');
await page.waitForFunction(() => window.__dev);

// a state where things have visibly happened: if / else, three steps in
await page.evaluate(() => {
  const d = window.__dev;
  const i = d.samples.findIndex((s) => s.name === 'if / else');
  d.viz.loadImage('if / else', d.samples[i].build().image);
  d.viz.listing.setBreakpoints([5]);
  d.viz.step(); d.viz.step(); d.viz.step();
});
await page.waitForTimeout(500);

const marks = [
  ['.brand', 1], ['.engine-badge', 2], ['.engine-switch', 3], ['.program-bar', 4], ['.viz-header .tabs', 5],
  ['.registers .reg-grid', 6], ['.pc-readout', 7, null, 'tr'], ['.listing-scroll', 8], ['.viz-col > .tabs', 9],
  ['.screen-frame', 10], ['.capture', 11, null, 'tr'], ['.history', 12], ['.tiles', 13],
  ['.t-block', 14, null, 'tr'], ['.state-chip', 15], ['.transport .btn:nth-child(1)', 16, '.transport .btn:nth-child(5)'],
  ['.speed-box', 17, null, 'tr'], ['.dir-toggle', 18], ['.strip', 19],
];

await page.evaluate((marks) => {
  const style = document.createElement('style');
  style.textContent = `
    .ann-box { position: fixed; z-index: 9999; border: 2px dashed #fff; border-radius: 6px; pointer-events: none; box-shadow: 0 0 0 1px #000; }
    .ann-num { position: fixed; z-index: 10000; width: 24px; height: 24px; border-radius: 50%; background: #fff; color: #0d1117;
      font: 700 14px/24px system-ui; text-align: center; pointer-events: none; box-shadow: 0 0 0 2px #0d1117; }`;
  document.head.append(style);
  for (const [sel, n, endSel, corner] of marks) {
    const a = document.querySelector(sel).getBoundingClientRect();
    const b = endSel ? document.querySelector(endSel).getBoundingClientRect() : a;
    const r = { left: a.left, top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
    const box = document.createElement('div');
    box.className = 'ann-box';
    Object.assign(box.style, { left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.right - r.left + 4}px`, height: `${r.bottom - r.top + 4}px` });
    const num = document.createElement('div');
    num.className = 'ann-num';
    num.textContent = String(n);
    Object.assign(num.style, { left: `${(corner === 'tr' ? r.right : r.left) - 12}px`, top: `${r.top - 12}px` });
    document.body.append(box, num);
  }
}, marks);

await page.screenshot({ path: join(out, 'annotated.png') });
console.log('wrote screenshots/annotated.png');
await browser.close();
await server.close();
